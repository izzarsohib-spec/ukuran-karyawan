// Menerima permintaan PERALATAN dari web (wajib login admin), menyimpan ke `peralatan_permintaan`,
// lalu mengirim ringkasan ke DUA pimpinan lewat ntfy dengan tombol Setujui dan Tolak/Revisi (token terpisah per pimpinan).
// Harga, RAB, dan terpakai selalu dihitung ulang di sini dari database; dari web hanya dipercaya: lokasi_id, sumber anggaran, id item, qty, memo.
//   sisa RAB = anggaran - terpakai - total jual   (anggaran peralatan lokasi, atau anggaran seragam bagian KEAMANAN bila sumber = 'seragam')
//   untung   = sisa RAB + (jual - beli)
// Keputusan pimpinan diproses fungsi `keputusan` (parameter m=peralatan).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const rp = (n: number) => (n < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

const PIMPINAN = [
  { kunci: 'yasir', nama: 'Pak Yasir', topik: () => Deno.env.get('NTFY_TOPIC')! },
  { kunci: 'ferry', nama: 'Pak Ferry', topik: () => Deno.env.get('NTFY_TOPIC_FERRY') || Deno.env.get('NTFY_TOPIC')! },
] as const;

// Hanya admin yang sedang login (PIC Pengadaan) yang boleh memakai fungsi ini: token pengguna dari header Authorization diperiksa ke Supabase Auth,
// lalu dicocokkan dengan tabel admin_pengguna. Kunci anon (tanpa login) ditolak.
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

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const lokasiId = Number(body?.lokasi_id), sumber = body?.sumber === 'seragam' ? 'seragam' : 'peralatan';
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  const memo = String(body?.memo ?? '').trim().slice(0, 1000);
  // lampiran surat: satu gambar JPG (base64) per halaman memo, PO, daftar harga, RAB
  const gambar: string[] = Array.isArray(body?.halaman) ? body.halaman.map(String).slice(0, 12) : [];
  if (!lokasiId || !items.length) return balas({ error: 'Data permintaan belum lengkap' }, 400);
  if (items.length > 100) return balas({ error: 'Terlalu banyak item' }, 413);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!(await adalahAdmin(db, req))) return balas({ error: 'Perlu login admin untuk mengirim permintaan. Masuk dulu di halaman web.' }, 401);
  const { count: baruSaja } = await db.from('peralatan_permintaan').select('id', { count: 'exact', head: true }).gte('dibuat', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((baruSaja ?? 0) >= 20) return balas({ error: 'Terlalu banyak permintaan dalam 10 menit terakhir, coba lagi nanti' }, 429);

  const { data: lok } = await db.from('peralatan_lokasi').select('*').eq('id', lokasiId).eq('aktif', true).maybeSingle();
  if (!lok) return balas({ error: 'Lokasi tidak dikenal' }, 400);

  // gabungkan item kembar, validasi qty, ambil harga dari katalog
  const qtyPerItem = new Map<number, number>();
  for (const it of items) {
    const id = Number(it?.item_id), qty = Number(it?.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 9999) return balas({ error: 'Ada item atau qty yang tidak valid' }, 400);
    qtyPerItem.set(id, (qtyPerItem.get(id) ?? 0) + qty);
  }
  const { data: katalog } = await db.from('peralatan_item').select('id,nama,harga_beli,harga_jual').in('id', [...qtyPerItem.keys()]).eq('aktif', true);
  if ((katalog ?? []).length !== qtyPerItem.size) return balas({ error: 'Ada item yang tidak dikenal' }, 400);
  const baris = (katalog ?? []).map((k: any) => ({ item_id: k.id, nama: k.nama, qty: qtyPerItem.get(k.id)!, beli: Number(k.harga_beli), jual: Number(k.harga_jual) }));
  const tBeli = baris.reduce((a, b) => a + b.beli * b.qty, 0), tJual = baris.reduce((a, b) => a + b.jual * b.qty, 0);

  // anggaran dan yang sudah terpakai (yang ditolak tidak dihitung)
  let rab = 0, terpakai = 0;
  if (sumber === 'peralatan') {
    rab = Number(lok.rab) || 0;
    const { data: lalu } = await db.from('peralatan_permintaan').select('total_jual').eq('lokasi_id', lok.id).eq('sumber_anggaran', 'peralatan').neq('status', 'ditolak');
    terpakai = (lalu ?? []).reduce((a: number, x: any) => a + Number(x.total_jual || 0), 0);
  } else {
    if (!lok.seragam_lokasi_form) return balas({ error: 'Lokasi ini belum dipetakan ke anggaran seragam' }, 400);
    const { data: ang } = await db.from('anggaran_publik').select('anggaran').eq('lokasi_form', lok.seragam_lokasi_form).eq('bagian_kerja', lok.seragam_bagian).maybeSingle();
    if (!ang) return balas({ error: 'Anggaran seragam bagian keamanan lokasi ini tidak ditemukan' }, 400);
    rab = Number(ang.anggaran) || 0;
    const [{ data: sg }, { data: pr }] = await Promise.all([
      db.from('permintaan').select('total_jual').eq('lokasi_form', lok.seragam_lokasi_form).eq('bagian_kerja', lok.seragam_bagian).or('status.is.null,status.neq.ditolak'),
      db.rpc('peralatan_terpakai_seragam'),
    ]);
    terpakai = (sg ?? []).reduce((a: number, x: any) => a + Number(x.total_jual || 0), 0)
      + (pr ?? []).filter((x: any) => x.lokasi_form === lok.seragam_lokasi_form && x.bagian_kerja === lok.seragam_bagian).reduce((a: number, x: any) => a + Number(x.jual || 0), 0);
  }
  const sisa = rab - terpakai - tJual, untung = sisa + (tJual - tBeli);

  // riwayat lokasi: permintaan sebelumnya yang tidak ditolak pada masa kontrak berjalan (setelah kontrak_mulai bila diisi)
  const mulai = lok.kontrak_mulai ? new Date(lok.kontrak_mulai + 'T00:00:00').getTime() : 0;
  const { data: sebelum } = await db.from('peralatan_permintaan').select('tanggal').eq('lokasi_id', lok.id).neq('status', 'ditolak');
  const jumlahLalu = (sebelum ?? []).filter((x: any) => !x.tanggal || new Date(x.tanggal).getTime() >= mulai).length;

  const token: Record<string, string> = { yasir: acak(), ferry: acak() };
  const { data: baru, error: eIns } = await db.from('peralatan_permintaan').insert({
    lokasi_id: lok.id, sumber_anggaran: sumber, rab, anggota: lok.anggota, total_beli: tBeli, total_jual: tJual, untung, memo,
    status: 'menunggu', status_yasir: 'menunggu', status_ferry: 'menunggu', token_yasir: token.yasir, token_ferry: token.ferry, tanggal: new Date().toISOString(), asal: 'web',
  }).select('id').single();
  if (eIns || !baru) return balas({ error: 'Gagal menyimpan permintaan' }, 500);
  const { error: eItem } = await db.from('peralatan_permintaan_item').insert(baris.map((b) => ({ permintaan_id: baru.id, item_id: b.item_id, nama: b.nama, qty: b.qty, harga_beli: b.beli, harga_jual: b.jual, pemetaan: 'cocok' })));
  if (eItem) { await db.from('peralatan_permintaan').delete().eq('id', baru.id); return balas({ error: 'Gagal menyimpan item permintaan' }, 500); }

  const kepala = [
    `${lok.nama} (${lok.bagian})`,
    `Peralatan, memakai anggaran ${sumber}`,
    jumlahLalu ? `Riwayat lokasi: sudah ${jumlahLalu} permintaan pada kontrak ini, ini Penambahan ke-${jumlahLalu}` : 'Pengadaan awal di lokasi ini',
    '',
    `Anggaran RAB ${sumber}: ${rp(rab)}`,
    ...(terpakai > 0 ? [`Sudah terpakai dari RAB sebelumnya: ${rp(terpakai)}`] : []),
    `Total jual: ${rp(tJual)}`,
    `Sisa RAB: ${rp(sisa)}`,
    `Total beli: ${rp(tBeli)}`,
    `Untung: ${rp(untung)}`,
  ];
  const ekor = ['', 'Perlu persetujuan: Pak Yasir dan Pak Ferry', ...(memo ? ['', `Catatan: ${memo}`] : [])];
  const daftar = baris.map((b) => `- ${b.qty} x ${b.nama} | beli ${rp(b.beli)} | jual ${rp(b.jual)}`);
  const susun = (n: number) => [...kepala, '', 'Belanja:', ...daftar.slice(0, n), ...(n < daftar.length ? [`... dan ${daftar.length - n} item lainnya`] : []), ...ekor].join('\n');
  let teks = susun(daftar.length);
  for (let n = daftar.length; teks.length > 2800 && n > 0; n--) teks = susun(n - 1);

  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  // tiap halaman surat disimpan di Supabase Storage (folder acak); notifikasi membuka surat.html yang menampilkan semua halaman
  let urlSurat = '';
  if (gambar.length) {
    const folder = `${baru.id}-${acak().slice(0, 24)}`;
    for (let i = 0; i < gambar.length; i++) {
      const { error: eUp } = await db.storage.from('lampiran-surat').upload(`${folder}/${String(i + 1).padStart(2, '0')}.jpg`,
        Uint8Array.from(atob(gambar[i]), (c) => c.charCodeAt(0)), { contentType: 'image/jpeg', upsert: false });
      if (eUp) return balas({ error: `Tersimpan (no. ${baru.id}) tetapi halaman surat gagal disimpan`, id: baru.id }, 500);
    }
    urlSurat = `${WEB}/surat.html?f=${folder}&n=${gambar.length}&j=${encodeURIComponent(`${lok.nama} - Peralatan`)}`;
    await db.from('peralatan_permintaan').update({ lampiran_url: urlSurat }).eq('id', baru.id);
  }
  const urlWeb = urlSurat || `${WEB}/peralatan/`;
  const hasil: Record<string, number> = {};
  for (const p of PIMPINAN) {
    const url = (a: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/keputusan?m=peralatan&id=${baru.id}&p=${p.kunci}&t=${token[p.kunci]}&a=${a}`;
    const urlRevisi = `${WEB}/revisi.html?m=peralatan&id=${baru.id}&p=${p.kunci}&t=${token[p.kunci]}`;
    try {
      const r = await fetch(`https://ntfy.sh/${p.topik()}`, {
        method: 'POST',
        headers: {
          Title: kodekan(`Permintaan peralatan: ${lok.nama} (untuk ${p.nama})`.slice(0, 120)),
          Click: urlWeb, Priority: '4', Tags: 'toolbox',
          Actions: `http, Setujui ${p.nama}, ${url('setuju')}, method=POST, clear=true; view, Tolak/Revisi ${p.nama}, ${urlRevisi}; view, ${urlSurat ? 'Buka surat' : 'Buka web'}, ${urlWeb}`,
        },
        body: teks,
      });
      hasil[p.kunci] = r.status;
    } catch { hasil[p.kunci] = 0; }
  }
  const ok = (k: string) => hasil[k] >= 200 && hasil[k] < 300;
  await db.from('peralatan_permintaan').update({ terkirim_yasir: ok('yasir'), terkirim_ferry: ok('ferry') }).eq('id', baru.id);
  if (!(ok('yasir') && ok('ferry'))) {
    const gagal = PIMPINAN.filter((p) => !ok(p.kunci)).map((p) => p.nama).join(' dan ');
    return balas({ error: `Tersimpan (no. ${baru.id}) tetapi notifikasi ke ${gagal} gagal terkirim`, id: baru.id }, 502);
  }
  return balas({ ok: true, id: baru.id, sisa, untung });
});
