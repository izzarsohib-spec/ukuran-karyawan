// Ganti halaman surat di notifikasi ntfy pimpinan. Tombol "◄ Sebelumnya" dan "Berikutnya ►" pada notifikasi (aksi `http` ntfy) memanggil fungsi ini;
// fungsi menerbitkan ulang notifikasi yang sama (X-Sequence-ID sama, jadi aplikasi ntfy MENGGANTI notifikasi lama) dengan lampiran gambar halaman yang dituju.
// Tanpa JWT (ntfy memanggilnya dari HP); dijaga tanda tangan HMAC pada parameter (i = nomor permintaan, p = y/f/a, f = folder surat, n = jumlah halaman),
// jadi hanya tautan yang dibuat oleh kirim-permintaan yang diterima. p=a adalah topik admin untuk uji coba.
import { createClient } from 'npm:@supabase/supabase-js@2';

const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const kunci = () => Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || Deno.env.get('N8N_TOKEN') || '';
async function tanda(teks: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(kunci()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(teks)));
  return [...s].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
const TOPIK: Record<string, () => string> = {
  y: () => Deno.env.get('NTFY_TOPIC') ?? '',
  f: () => Deno.env.get('NTFY_TOPIC_FERRY') || Deno.env.get('NTFY_TOPIC') || '',
  a: () => Deno.env.get('NTFY_TOPIC_ADMIN') ?? '',
};
const NAMA: Record<string, string> = { y: 'Pak Yasir', f: 'Pak Ferry', a: 'Admin (uji)' };

Deno.serve(async (req) => {
  const u = new URL(req.url), q = u.searchParams;
  const i = q.get('i') ?? '', p = q.get('p') ?? '', f = q.get('f') ?? '', n = Math.floor(Number(q.get('n'))), h = Math.floor(Number(q.get('h')));
  if (!kunci() || !['y', 'f', 'a'].includes(p) || !/^\d+$/.test(i) || !/^\d+-[a-f0-9]{24}$/.test(f) || !(n >= 1 && n <= 60) || !(h >= 1 && h <= n)) return new Response('Permintaan tidak valid', { status: 400 });
  if ((q.get('g') ?? '') !== await tanda(`${i}.${p}.${f}.${n}`)) return new Response('Tidak diizinkan', { status: 401 });
  // uji coba (p=a): topik boleh ditentukan lewat parameter t, hanya yang berawalan ray-uji- (tautan tetap harus bertanda tangan sah)
  const uji = (q.get('t') ?? '').startsWith('ray-uji-') ? q.get('t')! : '';
  const topik = p === 'a' && uji ? uji : TOPIK[p](); if (!topik) return new Response('Topik belum diatur', { status: 500 });

  // judul + ringkasan: dari database (permintaan nyata), atau dari parameter pada uji coba (p=a)
  let judul = '', ringkas = '', urlKeputusan = '';
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  if (p === 'a') {
    judul = (q.get('j') ?? 'Uji coba').slice(0, 120); ringkas = (q.get('r') ?? '').slice(0, 400); urlKeputusan = WEB + '/';
  } else {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: r } = await db.from('permintaan').select('client,bagian_kerja,jumlah_anggota,total_jual,total_beli,untung,memo,token_yasir,token_ferry').eq('id', Number(i)).maybeSingle();
    if (!r) return new Response('Permintaan tidak ditemukan', { status: 404 });
    const tJ = Number(r.total_jual) || 0, tB = Number(r.total_beli) || 0, sisa = Number(r.untung) - (tJ - tB);
    const tambah = String(r.memo ?? '').split('\n').find((l: string) => l.startsWith('PENAMBAHAN ITEM: '))?.slice(17).trim();
    judul = `${tambah ? 'PENAMBAHAN ITEM - ' : ''}Permintaan seragam: ${r.client} (untuk ${NAMA[p]})`.slice(0, 120);
    ringkas = [`Bagian: ${r.bagian_kerja} (${r.jumlah_anggota} anggota)`, ...(tambah ? [`PENAMBAHAN ITEM: ${tambah}`] : []), `Total jual ${rp(tJ)} · Sisa RAB ${rp(sisa)} · Untung ${rp(Number(r.untung) || 0)}`, 'Perlu persetujuan: Pak Yasir dan Pak Ferry'].join('\n');
    const token = p === 'y' ? r.token_yasir : r.token_ferry;
    urlKeputusan = `${WEB}/setujui.html?id=${i}&p=${p === 'y' ? 'yasir' : 'ferry'}&t=${token}`;
  }

  const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ntfy-halaman`, g = q.get('g')!;
  const tautan = (hal: number) => `${base}?i=${i}&p=${p}&f=${f}&n=${n}&h=${hal}&g=${g}${p === 'a' ? `&j=${encodeURIComponent(judul)}&r=${encodeURIComponent(ringkas)}${uji ? `&t=${uji}` : ''}` : ''}`;
  const sebelum = h === 1 ? n : h - 1, sesudah = h === n ? 1 : h + 1;
  const hasil = await fetch('https://ntfy.sh/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: topik, sequence_id: `surat-${i}-${p}`, title: judul, priority: 4, tags: ['package'],
      message: `${ringkas}\n\nHalaman ${h} dari ${n} · ketuk ◄ ► untuk berpindah`,
      attach: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${f}/${String(h).padStart(2, '0')}.jpg`, filename: `surat-halaman-${h}.jpg`,
      // mengetuk notifikasi membuka gambar halaman ini utuh (portrait, bisa dizoom); pratinjau di dalam notifikasi dipotong aplikasi ntfy (maks 150 dp)
      click: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${f}/${String(h).padStart(2, '0')}.jpg`,
      actions: [
        { action: 'http', label: '◄ Sebelumnya', url: tautan(sebelum), method: 'POST', clear: false },
        { action: 'http', label: 'Berikutnya ►', url: tautan(sesudah), method: 'POST', clear: false },
        { action: 'view', label: 'Setujui / Tolak', url: urlKeputusan },
      ],
    }),
  });
  if (!hasil.ok) { console.error('ntfy', hasil.status, (await hasil.text()).slice(0, 200)); return new Response('Gagal menerbitkan', { status: 502 }); }
  return new Response('ok', { status: 200 });
});
