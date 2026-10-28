// Pengingat rekap harian jam 18.00 WIB (dipanggil pg_cron dengan header X-Token = REKAP_TOKEN).
// Menghitung permintaan yang sudah disetujui kedua pimpinan tetapi PO-nya belum ditandai terkirim ke vendor, lalu memberi tahu admin (PIC Seragam):
// berapa permintaan dan pcs seragam + sepatu yang siap dikirim ke Mas Wahyu, serta aksesoris yang perlu dibelanjakan sendiri. Tidak mengirim apa pun ke vendor.
// Pemberitahuan: ntfy topik admin (NTFY_TOPIC_ADMIN) dan Telegram admin bila TELEGRAM_CHAT_ADMIN terpasang. Tidak ada pesan bila antrean kosong.
import { createClient } from 'npm:@supabase/supabase-js@2';

const balas = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const idn = (n: number) => Math.round(n).toLocaleString('id-ID');

Deno.serve(async (req) => {
  const sah = Deno.env.get('REKAP_TOKEN') ?? '';
  if (!sah || req.headers.get('x-token') !== sah) return balas({ error: 'Tidak diizinkan' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [{ data: ps }, { data: harga }] = await Promise.all([
    db.from('permintaan').select('id,client,bagian_kerja,items,status,status_yasir,status_ferry').is('po_dikirim', null).order('id'),
    db.from('harga_seragam').select('no,kategori'),
  ]);
  const kat = new Map((harga ?? []).map((h: any) => [Number(h.no), String(h.kategori ?? '')]));
  const antre = (ps ?? []).filter((p: any) => (p.status_yasir ?? p.status) === 'disetujui' && (p.status_ferry ?? p.status) === 'disetujui');
  let pcsVendor = 0, pcsAks = 0; const jenisAks = new Set<number>();
  for (const p of antre) for (const i of (p.items ?? [])) {
    const q = Number(i.qty) || 0;
    if (kat.get(Number(i.no)) === 'Aksesoris') { pcsAks += q; jenisAks.add(Number(i.no)); } else pcsVendor += q;
  }
  if (!antre.length) return balas({ ok: true, antrean: 0 });
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  const judul = `Rekap jam 18.00: ${antre.length} permintaan siap dikirim ke Mas Wahyu`;
  const teks = [`${antre.length} permintaan sudah disetujui kedua pimpinan dan belum dikirim ke vendor.`, `Seragam + sepatu untuk Mas Wahyu: ${idn(pcsVendor)} pcs.`, pcsAks ? `Aksesoris untuk dibelanjakan sendiri: ${idn(pcsAks)} pcs (${jenisAks.size} jenis).` : 'Tidak ada aksesoris.', '', 'Buka halaman Rekap Permintaan > Rekap harian untuk mengecek, mengunduh PDF, dan menandai terkirim.'].join('\n');
  const url = `${WEB}/seragam/#rekap`, hasil: Record<string, number> = {};
  const topik = Deno.env.get('NTFY_TOPIC_ADMIN');
  if (topik) { try { const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topik, title: judul, message: teks, click: url, priority: 3, tags: ['package'] }) }); hasil.ntfy = r.status; } catch { hasil.ntfy = 0; } }
  const tok = Deno.env.get('TELEGRAM_BOT_TOKEN'), chat = Deno.env.get('TELEGRAM_CHAT_ADMIN');
  if (tok && chat) { try { const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: `${judul}\n\n${teks}`, reply_markup: { inline_keyboard: [[{ text: 'Buka rekap harian', url }]] } }) }); hasil.telegram = r.status; } catch { hasil.telegram = 0; } }
  return balas({ ok: true, antrean: antre.length, pcsVendor, pcsAks, kirim: hasil });
});
