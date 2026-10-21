// Menerima permintaan seragam dari web, memeriksa kode akses, menyimpan ke tabel `permintaan`,
// lalu mengirim ringkasan + lampiran PDF ke atasan lewat ntfy.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const { kode, lokasi_form, bagian, items, memo, pdf } = body ?? {};
  if (!kode || !lokasi_form || !bagian || !Array.isArray(items) || !items.length || !pdf)
    return balas({ error: 'Data permintaan belum lengkap' }, 400);
  if (items.length > 100 || String(pdf).length > 4_000_000) return balas({ error: 'Permintaan terlalu besar' }, 413);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ok } = await db.rpc('cek_kode', { kode: String(kode) });
  if (ok !== true) return balas({ error: 'Kode akses salah' }, 403);

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
  const sisa = rab - tBeli, untung = (tJual - tBeli) + sisa;
  const catatan = String(memo ?? '').slice(0, 1000);

  // token sekali-pakai per permintaan: hanya penerima notifikasi yang punya tautan keputusan
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const { data: baru, error: eIns } = await db.from('permintaan').insert({
    lokasi_form, client: prog.client, bagian_kerja: bagian, jumlah_anggota: prog.target, rab,
    items: baris, total_beli: tBeli, total_jual: tJual, untung, memo: catatan, token_keputusan: token,
  }).select('id').single();
  if (eIns) return balas({ error: 'Gagal menyimpan permintaan' }, 500);

  const teks = [
    `${prog.client}`,
    `Bagian: ${bagian} (${prog.target} anggota)`,
    `Anggaran RAB: ${rp(rab)}`,
    '',
    'Belanja:',
    ...baris.map((b) => `- ${b.qty} x ${b.nama} | beli ${rp(b.beli)} | jual ${rp(b.jual)}`),
    '',
    `Total beli: ${rp(tBeli)}`,
    `Total jual: ${rp(tJual)}`,
    `Sisa RAB: ${rp(sisa)}`,
    `Untung: ${rp(untung)}`,
    ...(catatan ? ['', `Catatan: ${catatan}`] : []),
  ].join('\n').slice(0, 3000);

  const namaFile = `Permintaan ${prog.client} - ${bagian}.pdf`.replace(/[^\w .()-]/g, '');
  const bin = Uint8Array.from(atob(String(pdf)), (c) => c.charCodeAt(0));
  const r = await fetch(`https://ntfy.sh/${Deno.env.get('NTFY_TOPIC')}`, {
    method: 'PUT',
    headers: {
      Title: kodekan(`Permintaan seragam: ${prog.client}`.slice(0, 120)),
      Message: kodekan(teks),
      Filename: namaFile,
      Priority: '4',
      Tags: 'package',
      Actions: ['setuju|Setujui', 'tolak|Tolak/Revisi']
        .map((a) => `http, ${a.split('|')[1]}, ${Deno.env.get('SUPABASE_URL')}/functions/v1/keputusan?id=${baru.id}&t=${token}&a=${a.split('|')[0]}, method=POST, clear=true`)
        .join('; '),
    },
    body: bin,
  });
  if (!r.ok) return balas({ error: `Tersimpan (no. ${baru.id}) tetapi gagal terkirim ke ntfy (${r.status})`, id: baru.id }, 502);

  await db.from('permintaan').update({ terkirim: true }).eq('id', baru.id);
  return balas({ ok: true, id: baru.id });
});
