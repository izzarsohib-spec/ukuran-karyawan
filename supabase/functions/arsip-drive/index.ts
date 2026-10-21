// Mengarsipkan PDF memo dan invoice ke Google Drive lewat Apps Script milik pengguna (apps-script/arsip-drive.gs).
// Nama lokasi dan bagian selalu diambil dari database, bukan dari web, supaya file tidak bisa dikirim ke folder sembarangan.
// - memo: tanpa kode akses (halaman permintaan memang terbuka), tapi hanya untuk permintaan yang baru dibuat (maks. 60 menit).
// - invoice: wajib kode akses, sama seperti membuat tagihan.
// Rahasia: ARSIP_URL (alamat Web App Apps Script) dan ARSIP_TOKEN (harus sama dengan TOKEN di skrip).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const bersih = (s: string) => s.toLowerCase().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);
  const url = Deno.env.get('ARSIP_URL'), token = Deno.env.get('ARSIP_TOKEN');
  if (!url || !token) return balas({ error: 'Arsip Drive belum diatur', belum_diatur: true }, 503);

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const { jenis, id, pdf, kode } = body ?? {};
  if ((jenis !== 'memo' && jenis !== 'invoice') || !Number.isInteger(Number(id)) || typeof pdf !== 'string')
    return balas({ error: 'Data belum lengkap' }, 400);
  if (!pdf.startsWith('JVBER') || pdf.length > 14_000_000) return balas({ error: 'File PDF tidak valid atau terlalu besar' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let lokasi: string, bagian: string;
  if (jenis === 'memo') {
    const { data } = await db.from('permintaan').select('lokasi_form,bagian_kerja,dibuat').eq('id', Number(id)).maybeSingle();
    if (!data) return balas({ error: 'Permintaan tidak ditemukan' }, 404);
    if (Date.now() - new Date(data.dibuat).getTime() > 60 * 60_000) return balas({ error: 'Memo ini sudah lama, tidak bisa diarsipkan lewat web' }, 403);
    lokasi = data.lokasi_form; bagian = data.bagian_kerja;
  } else {
    const { error: eKode } = await db.rpc('_wajib_kode', { kode: String(kode ?? '') });
    if (eKode) return balas({ error: 'Kode akses salah' }, 403);
    const { data } = await db.from('tagihan').select('lokasi_form,bagian_kerja').eq('id', Number(id)).maybeSingle();
    if (!data) return balas({ error: 'Tagihan tidak ditemukan' }, 404);
    lokasi = data.lokasi_form; bagian = data.bagian_kerja;
  }
  const nama = `${bersih(lokasi)} ${bersih(bagian).split(' ')[0]} - ${jenis}`;

  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, lokasi, nama, pdf }), redirect: 'follow' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return balas({ error: `Apps Script tidak menjawab dengan benar (HTTP ${r.status})` }, 502);
    if (!j.ok) return balas({ error: 'Drive menolak: ' + String(j.error).slice(0, 200) }, 502);
    return balas({ ok: true, folder: j.folder, folderBaru: !!j.folderBaru, nama: j.nama, url: j.url });
  } catch (e) {
    return balas({ error: 'Gagal menghubungi Apps Script: ' + String(e).slice(0, 160) }, 502);
  }
});
