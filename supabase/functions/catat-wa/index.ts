// Dipanggil oleh n8n untuk mencatat hasil kirim WhatsApp (terkirim/gagal) dan keadaan sesi WAHA ke tabel wa_log.
// Bila ada kegagalan atau sesi putus, admin diberi tahu lewat ntfy (topik NTFY_TOPIC_ADMIN) supaya tidak diam-diam.
// Keamanan: header X-Token harus sama dengan rahasia N8N_TOKEN (sama dengan fungsi ingatkan-pic dan tagih-vendor).
import { createClient } from 'npm:@supabase/supabase-js@2';

const balas = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const samar = (n: unknown) => { const d = String(n ?? '').replace(/\D/g, ''); return d ? '…' + d.slice(-4) : null; };
const STATUS = ['diteruskan', 'terkirim', 'gagal', 'sesi_putus', 'sesi_pulih'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);
  const token = Deno.env.get('N8N_TOKEN') ?? '';
  if (!token || req.headers.get('x-token') !== token) return balas({ error: 'Tidak diizinkan' }, 401);
  let body: any; try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const entri = (Array.isArray(body?.entri) ? body.entri : [body]).slice(0, 50)
    .filter((e: any) => e && STATUS.includes(e.status))
    .map((e: any) => ({ jenis: String(e.jenis ?? 'sistem').slice(0, 20), nama: e.nama ? String(e.nama).slice(0, 120) : null, nomor: samar(e.nomor), status: e.status, galat: e.galat ? String(e.galat).slice(0, 400) : null, ref: e.ref ? String(e.ref).slice(0, 80) : null }));
  if (!entri.length) return balas({ error: 'Tidak ada entri yang valid' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // sesi_putus hanya diberitahukan sekali per 6 jam agar tidak membanjiri; dicek sebelum entri baru disimpan
  const { data: putusBaru } = await db.from('wa_log').select('id').eq('status', 'sesi_putus').gte('waktu', new Date(Date.now() - 6 * 3600_000).toISOString()).limit(1);
  const { error } = await db.from('wa_log').insert(entri);
  if (error) return balas({ error: 'Gagal mencatat' }, 500);

  const topik = Deno.env.get('NTFY_TOPIC_ADMIN');
  const kabar: string[] = [];
  const gagal = entri.filter((e: any) => e.status === 'gagal');
  if (gagal.length) kabar.push(`${gagal.length} pesan WhatsApp GAGAL terkirim:\n` + gagal.slice(0, 8).map((e: any) => `- ${e.nama ?? e.nomor ?? '?'}${e.galat ? ' (' + e.galat.slice(0, 80) + ')' : ''}`).join('\n'));
  if (entri.some((e: any) => e.status === 'sesi_putus') && !(putusBaru ?? []).length) kabar.push('Sesi WhatsApp (WAHA) PUTUS. Buka http://localhost:3001 di PC dan pindai ulang QR dari nomor bot, lalu pengingat berjalan lagi.');
  if (entri.some((e: any) => e.status === 'sesi_pulih')) kabar.push('Sesi WhatsApp (WAHA) sudah tersambung kembali.');
  if (topik && kabar.length) {
    try { await fetch(`https://ntfy.sh/${topik}`, { method: 'POST', headers: { Title: kodekan('Pengingat WhatsApp: perlu dicek'), Priority: gagal.length || entri.some((e: any) => e.status === 'sesi_putus') ? '4' : '3', Tags: 'warning' }, body: kabar.join('\n\n') }); } catch { /* abaikan */ }
  }
  return balas({ ok: true, dicatat: entri.length });
});
