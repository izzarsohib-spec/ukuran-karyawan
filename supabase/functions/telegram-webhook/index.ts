// Menerima pembaruan dari Telegram bot (webhook): (1) ketukan tombol ◀ ▶ pada pesan surat: foto diganti halaman lain di pesan yang sama
// (editMessageMedia), (2) pesan teks dari orang yang membuka bot: dibalas dengan ID chat-nya (dipakai untuk mendaftarkan pimpinan).
// Dibuat sengaja ringan agar ganti halaman cepat: tanpa pustaka dan tanpa kueri database. Folder surat dan jumlah halaman dibawa di callback_data
// ("h:<folder>:<y|f>:<halaman tujuan>:<jumlah halaman>[:<nomor pesan foto>]"), dan jawaban ke tombol dikirim bersamaan dengan penggantian foto.
// Keamanan: header X-Telegram-Bot-Api-Secret-Token harus sama dengan rahasia TELEGRAM_WEBHOOK_SECRET, tombol hanya berlaku bagi chat pimpinan
// yang terdaftar (TELEGRAM_CHAT_YASIR / TELEGRAM_CHAT_FERRY), dan folder surat berupa nama acak yang tidak bisa ditebak. Tanpa JWT karena Telegram tidak mengirimnya.

const OK = () => new Response('ok', { status: 200 });
const token = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
async function tg(metode: string, isi: unknown): Promise<{ ok: boolean; teks: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token()}/${metode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi) });
    return { ok: r.ok, teks: r.ok ? '' : (await r.text()).slice(0, 300) };
  } catch (e) { return { ok: false, teks: String(e) }; }
}
const chatPimpinan: Record<string, string> = { y: Deno.env.get('TELEGRAM_CHAT_YASIR') ?? '', f: Deno.env.get('TELEGRAM_CHAT_FERRY') ?? '' };
const SB = Deno.env.get('SUPABASE_URL') ?? '';

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
  const jawab = (teks?: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, ...(teks ? { text: teks } : {}) });
  const data = String(cq.data ?? '');
  if (data === 'x') { await jawab(); return OK(); } // tombol penunjuk halaman ("1 / 6") tidak melakukan apa-apa
  const m = /^h:(\d+-[a-f0-9]{24}):([yf]):(\d+):(\d+)(?::(\d+))?$/.exec(data);
  if (!m) { await jawab('Pesan lama: tombol tidak berlaku. Gunakan pesan surat yang terbaru.'); return OK(); }
  const folder = m[1], k = m[2], hal = Number(m[3]), jml = Number(m[4]), chatId = String(cq.message?.chat?.id ?? '');
  if (!chatPimpinan[k] || chatId !== chatPimpinan[k]) { await jawab('Tidak diizinkan'); return OK(); }
  if (!(jml >= 1 && jml <= 60) || hal < 1 || hal > jml) { await jawab(); return OK(); }

  const foto = `${SB}/storage/v1/object/public/lampiran-surat/${folder}/${String(hal).padStart(2, '0')}.jpg`;
  const sebelum = hal === 1 ? jml : hal - 1, sesudah = hal === jml ? 1 : hal + 1; // putar: dari halaman 1 mundur ke terakhir, dari terakhir maju ke 1
  const barisAksi = (cq.message?.reply_markup?.inline_keyboard ?? []).slice(-1)[0] ?? []; // baris Setujui / Tolak-Revisi dipertahankan apa adanya
  const mid = m[5] ? Number(m[5]) : 0; // nomor pesan foto (format baru: foto di BAWAH pesan tombol); kosong = format lama (foto di pesan yang sama dengan tombol)
  const tanda = `${hal} / ${jml}`, tombol = (h2: number) => `h:${folder}:${k}:${h2}:${jml}${mid ? ':' + mid : ''}`;
  const papan = { inline_keyboard: [[{ text: '◀', callback_data: tombol(sebelum) }, { text: tanda, callback_data: 'x' }, { text: '▶', callback_data: tombol(sesudah) }], barisAksi] };
  const kerja = mid
    ? [tg('editMessageMedia', { chat_id: chatId, message_id: mid, media: { type: 'photo', media: foto } }), tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: papan })]
    : [tg('editMessageMedia', { chat_id: chatId, message_id: cq.message.message_id, media: { type: 'photo', media: foto, caption: cq.message?.caption ?? '' }, reply_markup: papan })];
  const hasil = await Promise.all([...kerja, jawab()]); // jawab(): hentikan putaran loading di tombol tanpa menunggu foto selesai diganti
  for (const h of hasil.slice(0, kerja.length)) if (!h.ok && !h.teks.includes('message is not modified')) console.error('Telegram edit', h.teks);
  return OK();
});
