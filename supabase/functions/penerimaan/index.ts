// Form penerimaan seragam di lokasi, khusus penerima. Dibuka lewat tautan bertoken (pengiriman.token_terima) tanpa login.
//  GET  ?id=<pengiriman>&t=<token>  -> data surat jalan untuk ditampilkan di form (tanpa harga)
//  POST {id, t, penerima, tanggal_terima, foto:[dataURL jpeg...]} -> simpan penerimaan (tanda tangan dilakukan di surat jalan cetak)
// Foto (JPEG) disimpan di Storage publik (folder acak); pengiriman otomatis menjadi "diterima"; admin diberi tahu lewat ntfy.
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

  // ---- POST: simpan penerimaan (form sederhana: nama penerima, tanggal, foto; tanda tangan ada di surat jalan cetak) ----
  if (pen || g.status === 'diterima') return balas({ error: 'Penerimaan untuk surat jalan ini sudah diisi' }, 409);
  const penerima = teksBersih(body.penerima, 120);
  const tgl = /^d{4}-d{2}-d{2}$/.test(String(body.tanggal_terima)) ? String(body.tanggal_terima) : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  if (!penerima) return balas({ error: 'Nama penerima wajib diisi' }, 400);
  const fotoIn: unknown[] = Array.isArray(body.foto) ? body.foto.slice(0, 8) : [];
  const foto = fotoIn.map((f) => dariDataUrl(f, 'jpeg', 1_800_000)).filter((x): x is Uint8Array => !!x);
  if (!foto.length) return balas({ error: 'Lampirkan minimal satu foto' }, 400);
  if (foto.length !== fotoIn.length) return balas({ error: 'Ada foto yang tidak valid atau terlalu besar' }, 400);

  const folder = `terima-${id}-${acak().slice(0, 24)}`, url = (n: string) => `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${folder}/${n}`;
  try {
    for (let i = 0; i < foto.length; i++) { const { error } = await db.storage.from('lampiran-surat').upload(`${folder}/foto-${i + 1}.jpg`, foto[i], { contentType: 'image/jpeg', upsert: false }); if (error) throw new Error('Gagal menyimpan foto: ' + error.message); }
  } catch (e) { return balas({ error: String((e as Error).message) }, 500); }
  const { error: eIns } = await db.from('penerimaan').insert({ pengiriman_id: id, tanggal_terima: tgl, penerima, foto_urls: foto.map((_, i) => url(`foto-${i + 1}.jpg`)), jumlah_sesuai: 0, jumlah_masalah: 0 });
  if (eIns) return balas({ error: eIns.code === '23505' ? 'Penerimaan untuk surat jalan ini sudah diisi' : 'Gagal menyimpan penerimaan' }, eIns.code === '23505' ? 409 : 500);
  await db.from('pengiriman').update({ status: 'diterima', diterima_pada: new Date().toISOString(), penerima }).eq('id', id);

  const topik = Deno.env.get('NTFY_TOPIC_ADMIN');
  if (topik) {
    try { await fetch(`https://ntfy.sh/${topik}`, { method: 'POST', headers: { Title: kodekan(`Penerimaan diisi: ${g.client}`.slice(0, 120)), Priority: '3', Tags: 'package' },
      body: `${g.no_surat_jalan} · ${g.bagian_kerja}\nPenerima: ${penerima} (${tgl})\n${foto.length} foto terlampir. Lihat di halaman Penerimaan.` }); } catch { /* abaikan */ }
  }
  return balas({ ok: true, foto: foto.length });
});
