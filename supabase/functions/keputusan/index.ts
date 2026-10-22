// Dipanggil dari tombol di notifikasi ntfy pimpinan (Setujui / Tolak/Revisi).
// Ada dua pimpinan (Pak Yasir, Pak Ferry); masing-masing punya token sendiri dan memutuskan sekali.
// Status akhir: ditolak jika salah satu menolak; disetujui jika keduanya setuju; selain itu menunggu.
// verify_jwt dimatikan karena ntfy tidak bisa mengirim JWT; keamanan lewat token acak per permintaan per pimpinan.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Tombol Tolak/Revisi membuka halaman revisi.html di web; halaman itu memanggil fungsi ini dengan alasan di body JSON ({alasan}).
// Karena itu fungsi menjawab CORS dari web administrasi.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const teks = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
const NAMA: Record<string, string> = { yasir: 'Pak Yasir', ferry: 'Pak Ferry' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return teks('Gunakan tombol di notifikasi ntfy.', 405);
  const u = new URL(req.url), id = Number(u.searchParams.get('id')), t = u.searchParams.get('t') ?? '', a = u.searchParams.get('a'), p = u.searchParams.get('p');
  const keputusan = a === 'setuju' ? 'disetujui' : a === 'tolak' ? 'ditolak' : null;
  if (!id || t.length < 32 || !keputusan) return teks('Permintaan tidak valid.', 400);
  let alasan = '';
  if (keputusan === 'ditolak') { try { const b = await req.json(); alasan = String(b?.alasan ?? '').trim().slice(0, 500); } catch { /* tombol lama tanpa body */ } }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // m=peralatan: permintaan peralatan (tabel peralatan_permintaan); tanpa m: permintaan seragam
  const per = u.searchParams.get('m') === 'peralatan', tabel = per ? 'peralatan_permintaan' : 'permintaan';
  const { data: r } = per
    ? await db.from('peralatan_permintaan').select('status_yasir,status_ferry,token_yasir,token_ferry,lokasi:peralatan_lokasi(nama)').eq('id', id).maybeSingle()
    : await db.from('permintaan').select('client,bagian_kerja,status_yasir,status_ferry,token_yasir,token_ferry,token_keputusan').eq('id', id).maybeSingle();
  if (!r) return teks('Tautan tidak dikenali.', 403);
  const lokasi = per ? `peralatan ${(r as any).lokasi?.nama ?? ''}` : `${(r as any).client} - ${(r as any).bagian_kerja}`;

  // tautan lama (sebelum ada dua pimpinan): tanpa parameter p, memutuskan untuk keduanya sekaligus
  if (!p) {
    if (per) return teks('Permintaan tidak valid.', 400);
    if (!(r as any).token_keputusan || (r as any).token_keputusan !== t) return teks('Tautan tidak dikenali.', 403);
    if (r.status_yasir !== 'menunggu' || r.status_ferry !== 'menunggu') return teks('Sudah diputuskan.', 409);
    const now = new Date().toISOString();
    await db.from('permintaan').update({ status: keputusan, status_yasir: keputusan, status_ferry: keputusan, diputuskan: now, diputuskan_yasir: now, diputuskan_ferry: now }).eq('id', id);
    return teks(`Tercatat: ${keputusan} (${lokasi}).`);
  }

  if (p !== 'yasir' && p !== 'ferry') return teks('Permintaan tidak valid.', 400);
  const tokenSah = p === 'yasir' ? r.token_yasir : r.token_ferry;
  if (!tokenSah || tokenSah !== t) return teks('Tautan tidak dikenali.', 403);
  const sebelum = p === 'yasir' ? r.status_yasir : r.status_ferry;
  if (sebelum !== 'menunggu') return teks(`${NAMA[p]} sudah memutuskan: ${sebelum}.`, 409);

  const now = new Date().toISOString();
  const lain = p === 'yasir' ? r.status_ferry : r.status_yasir;
  const akhir = keputusan === 'ditolak' || lain === 'ditolak' ? 'ditolak' : keputusan === 'disetujui' && lain === 'disetujui' ? 'disetujui' : 'menunggu';
  const ubah: Record<string, unknown> = p === 'yasir' ? { status_yasir: keputusan, diputuskan_yasir: now } : { status_ferry: keputusan, diputuskan_ferry: now };
  if (alasan) ubah[p === 'yasir' ? 'alasan_yasir' : 'alasan_ferry'] = alasan;
  ubah.status = akhir; ubah.diputuskan = akhir === 'menunggu' ? null : now;
  const { error } = await db.from(tabel).update(ubah).eq('id', id).eq(p === 'yasir' ? 'status_yasir' : 'status_ferry', 'menunggu');
  if (error) return teks('Gagal menyimpan keputusan.', 500);
  // jika kedua pimpinan menekan hampir bersamaan, hitung ulang status akhir dari data terbaru
  const { data: s } = await db.from(tabel).select('status_yasir,status_ferry').eq('id', id).single();
  const fin = s && (s.status_yasir === 'ditolak' || s.status_ferry === 'ditolak') ? 'ditolak' : s && s.status_yasir === 'disetujui' && s.status_ferry === 'disetujui' ? 'disetujui' : 'menunggu';
  if (fin !== akhir) await db.from(tabel).update({ status: fin, diputuskan: fin === 'menunggu' ? null : now }).eq('id', id);
  const sisa = fin === 'menunggu' ? ` Menunggu ${NAMA[p === 'yasir' ? 'ferry' : 'yasir']}.` : fin === 'disetujui' ? ' Disetujui oleh kedua pimpinan.' : '';
  return teks(`Tercatat: ${NAMA[p]} ${keputusan} (${lokasi}).${sisa}`);
});
