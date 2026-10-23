// Form penerimaan seragam di lokasi, khusus penerima. Dibuka lewat tautan bertoken (pengiriman.token_terima) tanpa login.
//  GET  ?id=<pengiriman>&t=<token>  -> data surat jalan untuk ditampilkan di form (tanpa harga)
//  POST {id, t, penerima, jabatan, pic_nama, tanggal_terima, catatan, item:[{id,status,catatan}], ttd_penerima, ttd_pic, foto:[...]} -> simpan penerimaan
// Tanda tangan (PNG) dan foto (JPEG) disimpan di Storage publik (folder acak); pengiriman otomatis menjadi "diterima"; admin diberi tahu lewat ntfy.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const balas = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const STATUS = ['sesuai', 'kurang', 'rusak', 'salah_ukuran'];
const teksBersih = (v: unknown, maks: number) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, maks);

function dariDataUrl(s: unknown, jenis: 'png' | 'jpeg', maksByte: number): Uint8Array | null {
  const t = String(s ?? ''), awal = `data:image/${jenis};base64,`;
  if (!t.startsWith(awal)) return null;
  try {
    const bin = atob(t.slice(awal.length)); if (bin.length > maksByte || bin.length < 50) return null;
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const u = new URL(req.url);
  let body: any = null;
  if (req.method === 'POST') { try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); } }
  else if (req.method !== 'GET') return balas({ error: 'Metode tidak didukung' }, 405);
  const id = Number(body?.id ?? u.searchParams.get('id')), t = String(body?.t ?? u.searchParams.get('t') ?? '');
  if (!id || t.length < 32) return balas({ error: 'Tautan tidak valid' }, 400);
  const { data: g } = await db.from('pengiriman').select('id,no_surat_jalan,tanggal,client,bagian_kerja,lokasi_form,ekspedisi,no_resi,status,token_terima').eq('id', id).maybeSingle();
  if (!g || !g.token_terima || g.token_terima !== t) return balas({ error: 'Tautan tidak dikenali' }, 403);
  const { data: rows } = await db.from('pengiriman_item').select('id,nama,item_nama,qty,ukuran_baju,ukuran_celana,ukuran_sepatu').eq('pengiriman_id', id).order('nama').order('item_no');
  const { data: pen } = await db.from('penerimaan').select('id,penerima,tanggal_terima,dibuat').eq('pengiriman_id', id).maybeSingle();
  // PIC pemegang lokasi (untuk isian awal nama PIC)
  const { data: tugas } = await db.from('lokasi_penugasan').select('pic_id').ilike('lokasi', String(g.lokasi_form).replace(/[%_]/g, '')).limit(1).maybeSingle();
  let picNama = ''; if (tugas?.pic_id) { const { data: p } = await db.from('pic_lapangan').select('nama').eq('id', tugas.pic_id).maybeSingle(); picNama = p?.nama ?? ''; }

  if (req.method === 'GET') {
    return balas({ no_surat_jalan: g.no_surat_jalan, tanggal: g.tanggal, client: g.client, bagian: g.bagian_kerja, ekspedisi: g.ekspedisi, no_resi: g.no_resi, status: g.status, pic_nama: picNama, rows: rows ?? [], sudah: pen ? { penerima: pen.penerima, tanggal_terima: pen.tanggal_terima } : null });
  }

  // ---- POST: simpan penerimaan ----
  if (pen || g.status === 'diterima') return balas({ error: 'Penerimaan untuk surat jalan ini sudah diisi' }, 409);
  const penerima = teksBersih(body.penerima, 120), jabatan = teksBersih(body.jabatan, 80), picNamaIsi = teksBersih(body.pic_nama, 120) || picNama, catatan = teksBersih(body.catatan, 800);
  const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(body.tanggal_terima)) ? String(body.tanggal_terima) : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  if (!penerima) return balas({ error: 'Nama penerima wajib diisi' }, 400);
  const ttdPenerima = dariDataUrl(body.ttd_penerima, 'png', 600_000), ttdPic = dariDataUrl(body.ttd_pic, 'png', 600_000);
  if (!ttdPenerima) return balas({ error: 'Tanda tangan penerima wajib diisi' }, 400);
  if (!ttdPic) return balas({ error: 'Tanda tangan PIC wajib diisi' }, 400);
  const fotoIn: unknown[] = Array.isArray(body.foto) ? body.foto.slice(0, 6) : [];
  const foto = fotoIn.map((f) => dariDataUrl(f, 'jpeg', 1_800_000)).filter((x): x is Uint8Array => !!x);
  if (fotoIn.length && foto.length !== fotoIn.length) return balas({ error: 'Ada foto yang tidak valid atau terlalu besar' }, 400);
  const ada = new Set((rows ?? []).map((r: any) => r.id));
  const item: { id: number; status: string; catatan: string }[] = (Array.isArray(body.item) ? body.item : []).map((x: any) => ({ id: Number(x?.id), status: String(x?.status ?? 'sesuai'), catatan: teksBersih(x?.catatan, 300) }));
  if (item.some((x) => !ada.has(x.id) || !STATUS.includes(x.status)) || new Set(item.map((x) => x.id)).size !== item.length) return balas({ error: 'Data baris penerimaan tidak valid' }, 400);
  for (const r of rows ?? []) if (!item.some((x) => x.id === r.id)) item.push({ id: r.id, status: 'sesuai', catatan: '' });
  if (item.some((x) => x.status !== 'sesuai' && !x.catatan)) return balas({ error: 'Beri catatan untuk setiap baris yang bermasalah' }, 400);

  const folder = `terima-${id}-${acak().slice(0, 24)}`, url = (n: string) => `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${folder}/${n}`;
  const unggah = async (n: string, bytes: Uint8Array, tipe: string) => { const { error } = await db.storage.from('lampiran-surat').upload(`${folder}/${n}`, bytes, { contentType: tipe, upsert: false }); if (error) throw new Error('Gagal menyimpan berkas: ' + error.message); };
  try {
    await unggah('ttd-penerima.png', ttdPenerima, 'image/png'); await unggah('ttd-pic.png', ttdPic, 'image/png');
    for (let i = 0; i < foto.length; i++) await unggah(`foto-${i + 1}.jpg`, foto[i], 'image/jpeg');
  } catch (e) { return balas({ error: String((e as Error).message) }, 500); }

  const masalah = item.filter((x) => x.status !== 'sesuai').length;
  const { data: baru, error: eIns } = await db.from('penerimaan').insert({ pengiriman_id: id, tanggal_terima: tgl, penerima, jabatan_penerima: jabatan || null, pic_nama: picNamaIsi || null,
    ttd_penerima_url: url('ttd-penerima.png'), ttd_pic_url: url('ttd-pic.png'), foto_urls: foto.map((_, i) => url(`foto-${i + 1}.jpg`)), catatan: catatan || null,
    jumlah_sesuai: item.length - masalah, jumlah_masalah: masalah }).select('id').single();
  if (eIns) return balas({ error: eIns.code === '23505' ? 'Penerimaan untuk surat jalan ini sudah diisi' : 'Gagal menyimpan penerimaan' }, eIns.code === '23505' ? 409 : 500);
  await db.from('penerimaan_item').insert(item.map((x) => ({ penerimaan_id: baru.id, pengiriman_item_id: x.id, status: x.status, catatan: x.catatan || null })));
  await db.from('pengiriman').update({ status: 'diterima', diterima_pada: new Date().toISOString(), penerima }).eq('id', id);

  const topik = Deno.env.get('NTFY_TOPIC_ADMIN');
  if (topik) {
    try { await fetch(`https://ntfy.sh/${topik}`, { method: 'POST', headers: { Title: kodekan(`Penerimaan diisi: ${g.client}`.slice(0, 120)), Priority: masalah ? '4' : '3', Tags: masalah ? 'warning' : 'package' },
      body: `${g.no_surat_jalan} · ${g.bagian_kerja}\nPenerima: ${penerima}\n${item.length - masalah} baris sesuai${masalah ? `, ${masalah} bermasalah (lihat halaman Penerimaan)` : ''}` }); } catch { /* abaikan */ }
  }
  return balas({ ok: true, sesuai: item.length - masalah, masalah });
});
