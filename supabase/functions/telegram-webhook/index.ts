// Menerima pembaruan dari Telegram bot (webhook): (1) ketukan tombol ◀ ▶ pada pesan surat: foto diganti halaman lain di pesan yang sama
// (editMessageMedia), (2) pesan teks dari orang yang membuka bot: dibalas dengan ID chat-nya (dipakai untuk mendaftarkan pimpinan).
// Keamanan: header X-Telegram-Bot-Api-Secret-Token harus sama dengan rahasia TELEGRAM_WEBHOOK_SECRET, dan tombol hanya berlaku bagi chat pimpinan
// yang terdaftar (TELEGRAM_CHAT_YASIR / TELEGRAM_CHAT_FERRY). Tidak memakai JWT karena Telegram tidak mengirimnya.
import { createClient } from 'npm:@supabase/supabase-js@2';

const OK = () => new Response('ok', { status: 200 });
const token = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
async function tg(metode: string, isi: unknown): Promise<{ ok: boolean; teks: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token()}/${metode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi) });
    return { ok: r.ok, teks: r.ok ? '' : (await r.text()).slice(0, 300) };
  } catch (e) { return { ok: false, teks: String(e) }; }
}
const chatPimpinan: Record<string, string> = { y: Deno.env.get('TELEGRAM_CHAT_YASIR') ?? '', f: Deno.env.get('TELEGRAM_CHAT_FERRY') ?? '' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Metode tidak didukung', { status: 405 });
  const rahasia = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  if (!rahasia || req.headers.get('x-telegram-bot-api-secret-token') !== rahasia) return new Response('Tidak diizinkan', { status: 401 });
  let u: any; try { u = await req.json(); } catch { return OK(); }

  // pesan teks (mis. /start): balas dengan ID chat supaya admin bisa mendaftarkan penerima
  if (u?.message?.chat?.type === 'private' && u.message.chat.id) {
    await tg('sendMessage', { chat_id: u.message.chat.id, text: `Bot persetujuan seragam PT Ray Mitra Perkasa.\nBot ini hanya mengirim surat permintaan seragam; tidak perlu membalas.\n\nID chat Anda: ${u.message.chat.id}\n(berikan ID ini ke PIC Pengadaan untuk didaftarkan sebagai penerima)` });
    return OK();
  }

  const cq = u?.callback_query; if (!cq) return OK();
  const jawab = (teks?: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, ...(teks ? { text: teks, show_alert: false } : {}) });
  const m = /^h:(\d+):([yf]):(\d+)$/.exec(String(cq.data ?? ''));
  if (!m) { await jawab(); return OK(); } // tombol penunjuk halaman ("1 / 6") tidak melakukan apa-apa
  const [, idStr, k, halStr] = m, hal = Number(halStr), chatId = String(cq.message?.chat?.id ?? '');
  if (!chatPimpinan[k] || chatId !== chatPimpinan[k]) { await jawab('Tidak diizinkan'); return OK(); }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: p } = await db.from('permintaan').select('lampiran_url').eq('id', Number(idStr)).maybeSingle();
  let folder = '', jml = 0;
  try { const w = new URL(p?.lampiran_url ?? ''); folder = w.searchParams.get('f') ?? ''; jml = Math.floor(Number(w.searchParams.get('n'))); } catch { /* tautan tidak ada */ }
  if (!/^\d+-[a-f0-9]{24}$/.test(folder) || !(jml >= 1 && jml <= 60) || hal < 1 || hal > jml) { await jawab('Surat tidak ditemukan'); return OK(); }

  const foto = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${folder}/${String(hal).padStart(2, '0')}.jpg`;
  const sebelum = hal === 1 ? jml : hal - 1, sesudah = hal === jml ? 1 : hal + 1; // putar: dari halaman 1 mundur ke terakhir, dari terakhir maju ke 1
  const barisAksi = (cq.message?.reply_markup?.inline_keyboard ?? []).slice(-1)[0] ?? []; // baris Setujui / Tolak-Revisi dipertahankan apa adanya
  const hasil = await tg('editMessageMedia', {
    chat_id: chatId, message_id: cq.message.message_id,
    media: { type: 'photo', media: foto, caption: cq.message?.caption ?? '' },
    reply_markup: { inline_keyboard: [[{ text: '◀', callback_data: `h:${idStr}:${k}:${sebelum}` }, { text: `${hal} / ${jml}`, callback_data: 'x' }, { text: '▶', callback_data: `h:${idStr}:${k}:${sesudah}` }], barisAksi] },
  });
  if (!hasil.ok && !hasil.teks.includes('message is not modified')) console.error('editMessageMedia', hasil.teks);
  await jawab();
  return OK();
});
