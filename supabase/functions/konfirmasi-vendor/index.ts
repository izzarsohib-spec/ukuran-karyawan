// Konfirmasi pesanan oleh vendor (Mas Wahyu) lewat ntfy.
//   POST ?a=kirim   (admin login) : buat konfirmasi + kirim notifikasi ntfy berisi PDF rekap dan tombol jawaban.
//   GET  ?t=TOKEN                 : ringkasan untuk halaman konfirmasi.html (hanya pemegang token).
//   POST ?t=TOKEN&a=jawab         : vendor menjawab; tanggal estimasi lewat ?estimasi=YYYY-MM-DD (tombol cepat ntfy) atau body JSON {estimasi, catatan}.
//   POST ?t=TOKEN&a=tidak_bisa    : vendor tidak bisa memenuhi (body JSON {catatan}).
// verify_jwt dimatikan karena tombol ntfy tidak bisa mengirim JWT; keamanan lewat token acak per pengiriman. Aksi "kirim" memeriksa admin sendiri.
// Rahasia: NTFY_TOPIC_WAHYU (topik ntfy Mas Wahyu), NTFY_TOPIC_ADMIN (pemberitahuan ke admin, opsional).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info' };
const teks = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const wib = (tambahHari = 0) => new Date(Date.now() + 7 * 3600e3 + tambahHari * 864e5).toISOString().slice(0, 10);
const tgl = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const BASE = 'https://izzarsohib-spec.github.io/ukuran-karyawan';

async function adalahAdmin(db: any, req: Request): Promise<boolean> {
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const { data, error } = await db.auth.getUser(t);
  if (error || !data?.user) return false;
  const { data: a } = await db.from('admin_pengguna').select('user_id').eq('user_id', data.user.id).eq('aktif', true).maybeSingle();
  return !!a;
}

async function kabari(judul: string, isi: string) {
  const topik = Deno.env.get('NTFY_TOPIC_ADMIN'); if (!topik) return;
  try { await fetch(`https://ntfy.sh/${topik}`, { method: 'POST', headers: { Title: kodekan(judul), Priority: '3', Tags: 'handshake' }, body: isi }); } catch { /* abaikan */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url), t = u.searchParams.get('t') ?? '', a = u.searchParams.get('a') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ---------- admin: buat konfirmasi dan kirim ntfy ----------
  if (req.method === 'POST' && a === 'kirim') {
    if (!(await adalahAdmin(db, req))) return json({ error: 'Perlu login admin' }, 401);
    const topik = Deno.env.get('NTFY_TOPIC_WAHYU');
    if (!topik) return json({ error: 'Topik ntfy Mas Wahyu belum diatur (rahasia NTFY_TOPIC_WAHYU).' }, 412);
    let b: any; try { b = await req.json(); } catch { return json({ error: 'Isi permintaan tidak valid' }, 400); }
    const ids: number[] = Array.isArray(b?.permintaan_ids) ? b.permintaan_ids.map(Number).filter(Boolean) : [];
    const ringkasan = b?.ringkasan ?? {}, pdf = String(b?.pdf ?? ''), vendor = String(b?.vendor ?? 'Wahyu Ardianto').slice(0, 80);
    if (!ids.length || !pdf) return json({ error: 'Data pesanan atau PDF kosong' }, 400);
    const token = acak();
    const { data: baris, error } = await db.from('konfirmasi_vendor').insert({ token, vendor, permintaan_ids: ids, ringkasan }).select('id').single();
    if (error || !baris) return json({ error: 'Gagal menyimpan konfirmasi: ' + (error?.message ?? '') }, 500);
    const fn = `${Deno.env.get('SUPABASE_URL')}/functions/v1/konfirmasi-vendor`;
    const cepat = (hari: number, label: string) => `http, ${label} (${tgl(wib(hari))}), ${fn}?t=${token}&a=jawab&estimasi=${wib(hari)}, method=POST, clear=true`;
    const aksi = [cepat(3, 'Siap 3 hari'), cepat(7, 'Siap 1 minggu'), `view, Pilih tanggal / catatan, ${BASE}/konfirmasi.html?t=${token}, clear=true`].join('; ');
    const rl = (ringkasan.lokasi ?? []) as { client: string; bagian: string; pcs: number }[];
    const pesan = [`Pesanan ke ${vendor} (${ringkasan.total_pcs ?? '?'} pcs, ${rl.length} lokasi). PDF rekap terlampir.`, 'Mohon konfirmasi kapan pesanan bisa selesai/datang:', '- ketuk "Siap 3 hari" atau "Siap 1 minggu", atau', '- "Pilih tanggal / catatan" untuk tanggal lain.',
      '', ...(ringkasan.jenis ?? []).map((j: any) => `${j.jenis}: ${j.total} pcs`)].join('\n');
    const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
    const r = await fetch(`https://ntfy.sh/${topik}`, { method: 'PUT', body: bytes, headers: { Filename: `Rekap pesanan ${wib()}.pdf`, Title: kodekan(`Pesanan baru untuk ${vendor}`), Message: kodekan(pesan), Priority: '4', Tags: 'package', Actions: aksi } });
    if (!r.ok) { await db.from('konfirmasi_vendor').delete().eq('id', baris.id); return json({ error: `ntfy menolak (${r.status}). Periksa topik dan ukuran PDF.` }, 502); }
    return json({ ok: true, id: baris.id });
  }

  // ---------- vendor: lihat ringkasan ----------
  if (req.method === 'GET') {
    if (t.length < 32) return teks('Tautan tidak valid.', 400);
    const { data: k } = await db.from('konfirmasi_vendor').select('vendor,ringkasan,dikirim_pada,status,estimasi,catatan,dijawab_pada').eq('token', t).maybeSingle();
    if (!k) return teks('Tautan tidak dikenali.', 403);
    return json(k);
  }
  if (req.method !== 'POST') return teks('Gunakan tombol di notifikasi ntfy.', 405);

  // ---------- vendor: menjawab ----------
  if (t.length < 32 || (a !== 'jawab' && a !== 'tidak_bisa')) return teks('Permintaan tidak valid.', 400);
  const { data: k } = await db.from('konfirmasi_vendor').select('id,vendor,ringkasan,jumlah_jawab').eq('token', t).maybeSingle();
  if (!k) return teks('Tautan tidak dikenali.', 403);
  let body: any = {}; try { body = await req.json(); } catch { /* tombol cepat tanpa body */ }
  const catatan = String(body?.catatan ?? '').trim().slice(0, 500) || null;
  const total = k.ringkasan?.total_pcs ?? '?';

  if (a === 'tidak_bisa') {
    await db.from('konfirmasi_vendor').update({ status: 'tidak_bisa', estimasi: null, catatan, dijawab_pada: new Date().toISOString(), jumlah_jawab: k.jumlah_jawab + 1 }).eq('id', k.id);
    await kabari(`${k.vendor}: tidak bisa memenuhi`, `Pesanan ${total} pcs.${catatan ? ' Catatan: ' + catatan : ''}`);
    return teks('Tercatat: pesanan belum bisa dipenuhi. Terima kasih.');
  }
  const est = String(u.searchParams.get('estimasi') ?? body?.estimasi ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(est) || isNaN(Date.parse(est))) return teks('Tanggal tidak valid.', 400);
  if (est < wib()) return teks('Tanggal tidak boleh sebelum hari ini.', 400);
  if (est > wib(180)) return teks('Tanggal terlalu jauh (maksimal 180 hari).', 400);
  const ubah = { status: 'dikonfirmasi', estimasi: est, ...(catatan ? { catatan } : {}), dijawab_pada: new Date().toISOString(), jumlah_jawab: k.jumlah_jawab + 1 };
  const { error } = await db.from('konfirmasi_vendor').update(ubah).eq('id', k.id);
  if (error) return teks('Gagal menyimpan.', 500);
  await kabari(`${k.vendor}: siap ${tgl(est)}`, `Pesanan ${total} pcs, estimasi datang ${tgl(est)}.${catatan ? ' Catatan: ' + catatan : ''}${k.jumlah_jawab ? ' (jawaban diperbarui)' : ''}`);
  return teks(`Tercatat: estimasi pesanan siap ${tgl(est)}. Terima kasih.`);
});
