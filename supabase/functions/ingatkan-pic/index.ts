// Meneruskan pengingat pengisian ukuran ke n8n (lalu WAHA) untuk dikirim ke WhatsApp tiap PIC lapangan.
// Web hanya mengirim id PIC + teks pesan; nomor telepon selalu diambil dari database. Wajib login admin.
// Rahasia: N8N_WEBHOOK_URL (alamat node Webhook n8n) dan N8N_TOKEN (dikirim di header X-Token, dicek oleh n8n).
// Isi yang dikirim ke n8n: { pesan: [{ nomor: "62812...", chatId: "62812...@c.us", nama, teks }] }
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const noWa = (t: string) => { const d = String(t ?? '').replace(/\D/g, ''); return !d ? '' : d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };

// Mode uji: selama rahasia WA_NOMOR_UJI terisi, semua pesan WhatsApp dialihkan ke nomor itu (nama penerima asli ditulis di awal pesan).
// Hapus rahasianya saat sistem dipakai sungguhan.
const alihUji = (nomor: string, nama: string, teks: string) => { const u = noWa(Deno.env.get('WA_NOMOR_UJI') ?? ''); return u ? { nomor: u, chatId: u + '@c.us', teks: `[UJI - seharusnya untuk ${nama}]\n\n${teks}` } : { nomor, chatId: nomor + '@c.us', teks }; };

async function adalahAdmin(db: any, req: Request): Promise<boolean> {
  const t = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const { data, error } = await db.auth.getUser(t);
  if (error || !data?.user) return false;
  const { data: a } = await db.from('admin_pengguna').select('user_id').eq('user_id', data.user.id).eq('aktif', true).maybeSingle();
  return !!a;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);
  const url = Deno.env.get('N8N_WEBHOOK_URL'), token = Deno.env.get('N8N_TOKEN');
  if (!url || !token) return balas({ error: 'Sambungan n8n belum diatur', belum_diatur: true }, 503);

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const daftar = Array.isArray(body?.pesan) ? body.pesan : [];
  if (!daftar.length || daftar.length > 20) return balas({ error: 'Daftar pesan kosong atau terlalu banyak' }, 400);
  if (daftar.some((x: any) => !Number.isInteger(Number(x?.pic_id)) || typeof x?.teks !== 'string' || !x.teks.trim() || x.teks.length > 4000))
    return balas({ error: 'Data pesan tidak valid' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!(await adalahAdmin(db, req))) return balas({ error: 'Perlu login admin' }, 401);

  const { data: pics } = await db.from('pic_lapangan').select('id,nama,telepon,aktif').in('id', daftar.map((x: any) => Number(x.pic_id)));
  const peta = new Map((pics ?? []).map((p: any) => [p.id, p]));
  const kirim: any[] = [], lewat: any[] = [];
  for (const x of daftar) {
    const p: any = peta.get(Number(x.pic_id)), nomor = p && p.aktif ? noWa(p.telepon) : '';
    if (!nomor) lewat.push({ pic_id: Number(x.pic_id), nama: p?.nama ?? null, alasan: !p ? 'PIC tidak ditemukan' : !p.aktif ? 'PIC nonaktif' : 'Nomor telepon belum diisi' });
    else kirim.push({ pic_id: p.id, nama: p.nama, ...alihUji(nomor, p.nama, x.teks) });
  }
  if (!kirim.length) return balas({ ok: false, terkirim: 0, dilewati: lewat, error: 'Tidak ada PIC yang bisa dikirimi' }, 422);

  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': token }, body: JSON.stringify({ pesan: kirim }) });
    if (!r.ok) return balas({ error: `n8n menolak (HTTP ${r.status})` }, 502);
    return balas({ ok: true, terkirim: kirim.length, dilewati: lewat });
  } catch (e) {
    return balas({ error: 'Gagal menghubungi n8n: ' + String(e).slice(0, 160) }, 502);
  }
});
