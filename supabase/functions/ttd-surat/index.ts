// Dipanggil surat.html: memberi tanda tangan digital pimpinan yang SUDAH menyetujui permintaan itu, untuk ditempel di halaman surat.
// Gambar tanda tangan disimpan di bucket privat `tanda-tangan` (yasir.png, ferry.png) dan hanya keluar lewat fungsi ini
// setelah pimpinan yang bersangkutan menekan Setujui. verify_jwt dimatikan (surat.html dibuka dari tautan ntfy tanpa login);
// kuncinya adalah nama folder surat yang acak. Permintaan yang ditolak/ditarik tidak menampilkan tanda tangan apa pun.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const balas = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const NAMA: Record<string, string> = { yasir: 'Yasir Arafat', ferry: 'Feri Atmadi' };

// kode verifikasi pendek: HMAC dari nomor permintaan, pimpinan, dan waktu keputusan; kunci diturunkan dari service role key (tidak disimpan di mana pun)
async function kode(id: number, p: string, waktu: string) {
  const kunci = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', kunci, new TextEncoder().encode(`ttd|${id}|${p}|${waktu}`)));
  return Array.from(sig.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const base64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return balas({ error: 'Metode tidak didukung' }, 405);
  const u = new URL(req.url), f = u.searchParams.get('f') ?? '';
  if (!/^\d+-[a-f0-9]{24}$/.test(f)) return balas({ error: 'Tautan tidak valid' }, 400);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const id = Number(f.split('-')[0]);
  const { data: x } = await db.from('permintaan').select('id,status,status_yasir,status_ferry,diputuskan_yasir,diputuskan_ferry,ttd_pos,lampiran_url').eq('id', id).maybeSingle();
  if (!x || !String(x.lampiran_url ?? '').includes(`f=${f}`)) return balas({ error: 'Surat tidak dikenali' }, 404);
  const pos = Array.isArray(x.ttd_pos) ? x.ttd_pos : [];
  const ttd: Record<string, unknown> = {};
  if (x.status !== 'ditolak') {
    for (const p of ['yasir', 'ferry'] as const) {
      const status = p === 'yasir' ? x.status_yasir : x.status_ferry, waktu = p === 'yasir' ? x.diputuskan_yasir : x.diputuskan_ferry;
      if (status !== 'disetujui' || !waktu || !pos.some((t: any) => t.p === p)) continue;
      const { data: berkas } = await db.storage.from('tanda-tangan').download(`${p}.png`);
      if (!berkas) continue;
      ttd[p] = { nama: NAMA[p], waktu, kode: await kode(id, p, waktu), gambar: 'data:image/png;base64,' + base64(new Uint8Array(await berkas.arrayBuffer())) };
    }
  }
  return balas({ id, status: x.status, pos, ttd });
});
