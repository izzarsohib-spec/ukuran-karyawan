// Menerima permintaan seragam dari web (terbuka, tanpa kode akses), menyimpan ke tabel `permintaan`,
// lalu mengirim ringkasan + lampiran gambar surat (JPG) ke DUA pimpinan lewat ntfy. Tiap pimpinan menerima notifikasinya sendiri
// dengan tombol Setujui dan Tolak/Revisi (ntfy hanya mengizinkan maksimal 3 tombol per notifikasi).
// Harga, RAB, dan jumlah anggota diambil ulang dari database; hanya no item, qty, memo, dan PDF yang dipercaya dari web.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
// header HTTP hanya ASCII, jadi teks UTF-8 dikodekan RFC 2047 (didukung ntfy)
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

// Topik terpisah per pimpinan (NTFY_TOPIC = Pak Yasir, NTFY_TOPIC_FERRY = Pak Ferry). Jika NTFY_TOPIC_FERRY tidak diisi,
// keduanya masuk ke topik yang sama sebagai dua notifikasi.
const PIMPINAN = [
  { kunci: 'yasir', nama: 'Pak Yasir', topik: () => Deno.env.get('NTFY_TOPIC')! },
  { kunci: 'ferry', nama: 'Pak Ferry', topik: () => Deno.env.get('NTFY_TOPIC_FERRY') || Deno.env.get('NTFY_TOPIC')! },
] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const { lokasi_form, bagian, items, memo, halaman, jpg } = body ?? {};
  // lampiran: satu gambar JPG per halaman surat (`halaman`); `jpg` (satu gambar) tetap diterima agar versi web lama tidak rusak
  const gambar: string[] = Array.isArray(halaman) ? halaman.map(String) : jpg ? [String(jpg)] : [];
  if (!lokasi_form || !bagian || !Array.isArray(items) || !items.length || !gambar.length)
    return balas({ error: 'Data permintaan belum lengkap' }, 400);
  if (gambar.length > 40 || gambar.some((g) => !g.startsWith('/9j/'))) return balas({ error: 'Gambar tidak valid' }, 400);
  if (items.length > 100 || gambar.reduce((a, g) => a + g.length, 0) > 14_000_000) return balas({ error: 'Permintaan terlalu besar' }, 413);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // tanpa kode akses: batasi jumlah kiriman supaya pimpinan tidak kebanjiran notifikasi
  const { count: baruSaja } = await db.from('permintaan').select('id', { count: 'exact', head: true }).gte('dibuat', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((baruSaja ?? 0) >= 20) return balas({ error: 'Terlalu banyak permintaan dalam 10 menit terakhir, coba lagi nanti' }, 429);

  const nos = items.map((i: any) => Number(i.no));
  const [{ data: harga }, { data: ang }, { data: prog }] = await Promise.all([
    db.from('harga_seragam').select('no,nama,harga_beli,harga_jual').in('no', nos),
    db.from('anggaran_publik').select('anggaran').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian).maybeSingle(),
    db.from('progres_pengisian').select('client,target').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian).maybeSingle(),
  ]);
  if (!prog) return balas({ error: 'Lokasi atau bagian tidak dikenal' }, 400);

  const baris = [];
  for (const i of items) {
    const h = (harga ?? []).find((x: any) => x.no === Number(i.no)), qty = Math.floor(Number(i.qty));
    if (!h || !(qty > 0)) return balas({ error: 'Ada item atau qty yang tidak valid' }, 400);
    baris.push({ no: h.no, nama: h.nama, qty, beli: h.harga_beli, jual: h.harga_jual });
  }
  const rab = Number(ang?.anggaran) || 0;
  const tBeli = baris.reduce((a, b) => a + b.beli * b.qty, 0), tJual = baris.reduce((a, b) => a + b.jual * b.qty, 0);
  // belanja permintaan sebelumnya pada lokasi + bagian yang sama ikut mengurangi RAB (yang ditolak/revisi tidak dihitung)
  const { data: lalu } = await db.from('permintaan').select('total_beli').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian).or('status.is.null,status.neq.ditolak');
  const terpakai = (lalu ?? []).reduce((a: number, x: any) => a + Number(x.total_beli || 0), 0);
  const sisa = rab - terpakai - tBeli, untung = (tJual - tBeli) + sisa;
  const catatan = String(memo ?? '').slice(0, 1000);

  // token sekali-pakai per permintaan DAN per pimpinan: hanya penerima notifikasi yang punya tautan keputusannya
  const token: Record<string, string> = { yasir: acak(), ferry: acak() };
  const { data: baru, error: eIns } = await db.from('permintaan').insert({
    lokasi_form, client: prog.client, bagian_kerja: bagian, jumlah_anggota: prog.target, rab,
    items: baris, total_beli: tBeli, total_jual: tJual, untung, memo: catatan,
    token_yasir: token.yasir, token_ferry: token.ferry,
  }).select('id').single();
  if (eIns) return balas({ error: 'Gagal menyimpan permintaan' }, 500);

  // Angka-angka penting ditaruh PALING ATAS supaya tetap terbaca walau notifikasi dipersingkat; daftar item di bawahnya.
  const kepala = [
    `${prog.client}`,
    `Bagian: ${bagian} (${prog.target} anggota)`,
    '',
    `Anggaran RAB: ${rp(rab)}`,
    ...(terpakai > 0 ? [`Sudah dibelanjakan sebelumnya: ${rp(terpakai)}`] : []),
    `Total beli: ${rp(tBeli)}`,
    `Total jual: ${rp(tJual)}`,
    `Sisa RAB: ${rp(sisa)}`,
    `Untung: ${rp(untung)}`,
  ];
  const ekor = ['', 'Perlu persetujuan: Pak Yasir dan Pak Ferry', 'Ketuk notifikasi ini untuk membuka surat lengkap.', ...(catatan ? ['', `Catatan: ${catatan}`] : [])];
  const daftar = baris.map((b) => `- ${b.qty} x ${b.nama} | beli ${rp(b.beli)} | jual ${rp(b.jual)}`);
  const susun = (n: number) => [...kepala, '', 'Belanja:', ...daftar.slice(0, n), ...(n < daftar.length ? [`... dan ${daftar.length - n} item lainnya (lihat surat)`] : []), ...ekor].join('\n');
  let teks = susun(daftar.length);
  for (let n = daftar.length; teks.length > 2800 && n > 0; n--) teks = susun(n - 1);

  // ntfy.sh gratis membatasi lampiran 2 MB per file, dan penampil gambar HP menciutkan gambar yang sangat panjang sehingga huruf pecah.
  // Jadi tiap halaman disimpan di Supabase Storage (folder acak, tidak bisa ditebak) dan notifikasi membuka halaman web surat
  // (surat.html) yang menampilkan semua halaman selebar layar. Tidak ada lampiran gambar di notifikasi.
  const folder = `${baru.id}-${acak().slice(0, 24)}`;
  for (let i = 0; i < gambar.length; i++) {
    const { error: eUp } = await db.storage.from('lampiran-surat').upload(`${folder}/${String(i + 1).padStart(2, '0')}.jpg`,
      Uint8Array.from(atob(gambar[i]), (c) => c.charCodeAt(0)), { contentType: 'image/jpeg', upsert: false });
    if (eUp) return balas({ error: `Tersimpan (no. ${baru.id}) tetapi halaman surat gagal disimpan`, id: baru.id }, 500);
  }
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  const urlSurat = `${WEB}/surat.html?f=${folder}&n=${gambar.length}&j=${encodeURIComponent(`${prog.client} - ${bagian}`)}`;
  await db.from('permintaan').update({ lampiran_url: urlSurat }).eq('id', baru.id);

  const hasil: Record<string, number> = {};
  for (const p of PIMPINAN) {
    const url = (a: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/keputusan?id=${baru.id}&p=${p.kunci}&t=${token[p.kunci]}&a=${a}`;
    // Tolak/Revisi membuka halaman web agar pimpinan bisa menulis alasan (tombol http ntfy tidak bisa menerima teks)
    const urlRevisi = `${WEB}/revisi.html?id=${baru.id}&p=${p.kunci}&t=${token[p.kunci]}`;
    try {
      const r = await fetch(`https://ntfy.sh/${p.topik()}`, {
        method: 'POST',
        headers: {
          Title: kodekan(`Permintaan seragam: ${prog.client} (untuk ${p.nama})`.slice(0, 120)),
          Click: urlSurat, // mengetuk notifikasi langsung membuka surat lengkap
          Priority: '4',
          Tags: 'package',
          Actions: `http, Setujui ${p.nama}, ${url('setuju')}, method=POST, clear=true; view, Tolak/Revisi ${p.nama}, ${urlRevisi}; view, Buka surat, ${urlSurat}`,
        },
        body: teks,
      });
      hasil[p.kunci] = r.status;
    } catch { hasil[p.kunci] = 0; }
  }
  const ok = (k: string) => hasil[k] >= 200 && hasil[k] < 300;
  await db.from('permintaan').update({ terkirim_yasir: ok('yasir'), terkirim_ferry: ok('ferry'), terkirim: ok('yasir') && ok('ferry') }).eq('id', baru.id);
  if (!(ok('yasir') && ok('ferry'))) {
    const gagal = PIMPINAN.filter((p) => !ok(p.kunci)).map((p) => p.nama).join(' dan ');
    return balas({ error: `Tersimpan (no. ${baru.id}) tetapi notifikasi ke ${gagal} gagal terkirim`, id: baru.id }, 502);
  }
  return balas({ ok: true, id: baru.id, ntfy: hasil });
});
