// Menerima permintaan seragam dari web (wajib login admin), menyimpan ke tabel `permintaan`,
// lalu mengirim ringkasan + lampiran gambar surat (JPG) ke DUA pimpinan lewat ntfy. Tiap pimpinan menerima notifikasinya sendiri
// dengan tombol Setujui dan Tolak/Revisi (ntfy hanya mengizinkan maksimal 3 tombol per notifikasi).
// Harga, RAB, dan jumlah anggota diambil ulang dari database; hanya no item, qty, memo, dan PDF yang dipercaya dari web.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
// header HTTP hanya ASCII, jadi teks UTF-8 dikodekan RFC 2047 (didukung ntfy)
const kodekan = (s: string) => '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

// Topik terpisah per pimpinan (NTFY_TOPIC = Pak Yasir, NTFY_TOPIC_FERRY = Pak Ferry). Jika NTFY_TOPIC_FERRY tidak diisi,
// keduanya masuk ke topik yang sama sebagai dua notifikasi.
const PIMPINAN = [
  { kunci: 'yasir', nama: 'Pak Yasir', topik: () => Deno.env.get('NTFY_TOPIC')! },
  { kunci: 'ferry', nama: 'Pak Ferry', topik: () => Deno.env.get('NTFY_TOPIC_FERRY') || Deno.env.get('NTFY_TOPIC')! },
] as const;

// Hanya admin yang sedang login (PIC Pengadaan) yang boleh memakai fungsi ini: token pengguna dari header Authorization diperiksa ke Supabase Auth,
// lalu dicocokkan dengan tabel admin_pengguna. Kunci anon (tanpa login) ditolak.
async function adalahAdmin(db: any, req: Request): Promise<boolean> {
  const t = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const { data, error } = await db.auth.getUser(t);
  if (error || !data?.user) return false;
  const { data: a } = await db.from('admin_pengguna').select('user_id').eq('user_id', data.user.id).eq('aktif', true).maybeSingle();
  return !!a;
}

type Notif = { id: number; client: string; bagian: string; target: number; rab: number; terpakai: number; tJual: number; sisa: number; tBeli: number; untung: number; pengingat?: string; tambahan?: string; catatan: string; baris: { nama: string; qty: number; beli: number; jual: number }[]; urlSurat: string; token: Record<string, string> };

// Angka-angka penting ditaruh PALING ATAS supaya tetap terbaca walau notifikasi dipersingkat; daftar item di bawahnya.
function teksNotif(n: Notif): string {
  const catatanTampil = n.catatan.split('\n').filter((l) => !l.startsWith(MARKER)).join('\n').trim();
  const kepala = [
    `${n.client}`,
    `Bagian: ${n.bagian} (${n.target} anggota)`,
    ...(n.tambahan ? ['', 'PENAMBAHAN ITEM (pesanan susulan)', `Keterangan: ${n.tambahan}`] : []),
    '',
    `Anggaran RAB: ${rp(n.rab)}`,
    ...(n.terpakai > 0 ? [`Sudah terpakai dari RAB sebelumnya: ${rp(n.terpakai)}`] : []),
    `Total jual: ${rp(n.tJual)}`,
    `Sisa RAB: ${rp(n.sisa)}`,
    `Total beli: ${rp(n.tBeli)}`,
    `Untung: ${rp(n.untung)}`,
  ];
  const ekor = ['', 'Perlu persetujuan: Pak Yasir dan Pak Ferry', ...(catatanTampil ? ['', `Catatan: ${catatanTampil}`] : [])];
  const daftar = n.baris.map((b) => `- ${b.qty} x ${b.nama} | beli ${rp(b.beli)} | jual ${rp(b.jual)}`);
  const susun = (k: number) => [...kepala, '', 'Belanja:', ...daftar.slice(0, k), ...(k < daftar.length ? [`... dan ${daftar.length - k} item lainnya (lihat surat)`] : []), ...ekor].join('\n');
  let teks = susun(daftar.length);
  for (let k = daftar.length; teks.length > 2800 && k > 0; k--) teks = susun(k - 1);
  return teks;
}

// kirim ke pimpinan yang kuncinya ada di `daftar`; hasil: kode status HTTP per pimpinan (0 = gagal tersambung)
// ---- Telegram (jalur utama bila TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_YASIR / TELEGRAM_CHAT_FERRY terpasang; ntfy menjadi cadangan bila Telegram gagal) ----
// Surat dikirim sebagai SATU pesan foto: halaman 1 + ringkasan + tombol ◀ ▶ (ganti halaman di tempat) + tombol Setujui / Tolak-Revisi.
const tgToken = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const tgChat = (kunci: string) => Deno.env.get(kunci === 'yasir' ? 'TELEGRAM_CHAT_YASIR' : 'TELEGRAM_CHAT_FERRY') ?? '';
async function tgPanggil(metode: string, isi: unknown): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken()}/${metode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi) });
    if (!r.ok) console.error('Telegram', metode, r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) { console.error('Telegram', metode, String(e)); return false; }
}
async function kirimTelegram(n: Notif, p: { kunci: string; nama: string }, urlSetuju: string, urlRevisi: string, teks: string, semuaHalaman: boolean): Promise<boolean> {
  const chat = tgChat(p.kunci); if (!tgToken() || !chat) return false;
  const judul = `${n.pengingat ? 'PENGINGAT ' + n.pengingat + ': ' : ''}${n.tambahan ? 'PENAMBAHAN ITEM - ' : ''}Permintaan seragam: ${n.client} (untuk ${p.nama})`.slice(0, 900);
  const aksi = [{ text: `✅ Setujui ${p.nama}`, url: urlSetuju }, { text: '✏️ Tolak / Revisi', url: urlRevisi }];
  if (semuaHalaman) {
    // satu pesan: foto halaman 1 + ringkasan (maks 1024 huruf) + tombol ◀ ▶ untuk ganti halaman di pesan yang sama (ditangani fungsi telegram-webhook) + tombol persetujuan
    const jml = jumlahHalaman(n.urlSurat), foto = halamanKe(n.urlSurat, 1); if (!foto) return false;
    const h = p.kunci[0]; // y / f
    const folder = (() => { try { return new URL(n.urlSurat).searchParams.get('f') ?? ''; } catch { return ''; } })();
    // callback_data memuat folder surat dan jumlah halaman supaya fungsi telegram-webhook tidak perlu membuka database (ganti halaman lebih cepat)
    const nav = jml > 1 ? [[{ text: '◀', callback_data: `h:${folder}:${h}:${jml}:${jml}` }, { text: `1 / ${jml}`, callback_data: 'x' }, { text: '▶', callback_data: `h:${folder}:${h}:2:${jml}` }]] : [];
    const cap = [judul, `Bagian: ${n.bagian} (${n.target} anggota)`, ...(n.tambahan ? [`PENAMBAHAN ITEM: ${n.tambahan}`] : []), `Total jual ${rp(n.tJual)} · Sisa RAB ${rp(n.sisa)} · Untung ${rp(n.untung)}`, 'Perlu persetujuan: Pak Yasir dan Pak Ferry'].join('\n').slice(0, 1000);
    return await tgPanggil('sendPhoto', { chat_id: chat, photo: foto, caption: cap, reply_markup: { inline_keyboard: [...nav, aksi] } });
  }
  return await tgPanggil('sendMessage', {
    chat_id: chat, text: (semuaHalaman ? '' : judul + '\n\n') + teks, disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [aksi] },
  });
}
// semuaHalaman: halaman 2..N surat dikirim lebih dulu sebagai pesan senyap (prioritas min) masing-masing berlampir gambar; pesan utama dikirim terakhir dengan halaman 1,
// jadi di aplikasi ntfy urutannya dari atas: pesan utama (halaman 1 + tombol), halaman 2, halaman 3, dst. Pengingat harian hanya mengirim pesan utama.
async function kirimNotif(n: Notif, daftar: string[], semuaHalaman = true): Promise<Record<string, number>> {
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  const teks = teksNotif(n), hasil: Record<string, number> = {};
  for (const p of PIMPINAN.filter((x) => daftar.includes(x.kunci))) {
    // Setujui membuka halaman konfirmasi (bukan satu ketukan) supaya tidak tersetujui karena salah sentuh
    const urlSetuju = `${WEB}/setujui.html?id=${n.id}&p=${p.kunci}&t=${n.token[p.kunci]}`;
    // Tolak/Revisi membuka halaman web agar pimpinan bisa menulis alasan (tombol http ntfy tidak bisa menerima teks)
    const urlRevisi = `${WEB}/revisi.html?id=${n.id}&p=${p.kunci}&t=${n.token[p.kunci]}`;
    // Telegram lebih dulu; bila tidak terpasang atau gagal, jatuh ke ntfy
    if ((Deno.env.get('NOTIF_JALUR') ?? 'telegram') !== 'ntfy' && await kirimTelegram(n, p, urlSetuju, urlRevisi, teks, semuaHalaman)) { hasil[p.kunci] = 200; continue; } // NOTIF_JALUR=ntfy: lewati Telegram
    // ntfy dengan tombol ◄ ► (aksi http ke fungsi ntfy-halaman): SATU pesan yang halaman suratnya diganti di tempat (sequence_id sama, aplikasi ntfy mengganti notifikasi lama)
    const jmlN = jumlahHalaman(n.urlSurat), folderN = folderSurat(n.urlSurat), kodeP = p.kunci[0];
    if (semuaHalaman && jmlN > 1 && folderN && kunciHal()) {
      try {
        const g = await tandaHal(`${n.id}.${kodeP}.${folderN}.${jmlN}`), base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ntfy-halaman`;
        const tautan = (hal: number) => `${base}?i=${n.id}&p=${kodeP}&f=${folderN}&n=${jmlN}&h=${hal}&g=${g}`;
        const ringkas = [`Bagian: ${n.bagian} (${n.target} anggota)`, ...(n.tambahan ? [`PENAMBAHAN ITEM: ${n.tambahan}`] : []), `Total jual ${rp(n.tJual)} · Sisa RAB ${rp(n.sisa)} · Untung ${rp(n.untung)}`, 'Perlu persetujuan: Pak Yasir dan Pak Ferry'].join('\n');
        const r = await fetch('https://ntfy.sh/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: p.topik(), sequence_id: `surat-${n.id}-${kodeP}`, title: `${n.tambahan ? 'PENAMBAHAN ITEM - ' : ''}Permintaan seragam: ${n.client} (untuk ${p.nama})`.slice(0, 120), priority: 4, tags: [n.tambahan ? 'heavy_plus_sign' : 'package'],
            message: `${ringkas}\n\nHalaman 1 dari ${jmlN} · ketuk ◄ ► untuk berpindah`, attach: halamanKe(n.urlSurat, 1), filename: 'surat-halaman-1.jpg',
            actions: [
              { action: 'http', label: '◄ Sebelumnya', url: tautan(jmlN), method: 'POST', clear: false },
              { action: 'http', label: 'Berikutnya ►', url: tautan(2), method: 'POST', clear: false },
              { action: 'view', label: 'Setujui / Tolak', url: urlSetuju },
            ],
          }),
        });
        if (r.ok) { hasil[p.kunci] = r.status; continue; }
        console.error('ntfy json', r.status, (await r.text()).slice(0, 200));
      } catch (e) { console.error('ntfy json', String(e)); /* jatuh ke pesan biasa di bawah */ }
    }
    try {
      const r = await fetch(`https://ntfy.sh/${p.topik()}`, {
        method: 'POST',
        headers: {
          Title: kodekan(`${n.pengingat ? 'PENGINGAT ' + n.pengingat + ': ' : ''}${n.tambahan ? 'PENAMBAHAN ITEM - ' : ''}Permintaan seragam: ${n.client} (untuk ${p.nama})`.slice(0, 120)),
          // tanpa Click: mengetuk notifikasi membuka gambar halaman 1 langsung di aplikasi ntfy (bisa dizoom). Gambar berupa tautan ke Storage, bukan unggahan, jadi tanpa batas 2 MB ntfy
          ...(halamanKe(n.urlSurat, 1) ? { Attach: halamanKe(n.urlSurat, 1), Filename: 'surat-halaman-1.jpg' } : {}),
          Priority: '4',
          Tags: n.tambahan ? 'heavy_plus_sign' : 'package',
          Actions: `view, Setujui ${p.nama}, ${urlSetuju}; view, Tolak/Revisi ${p.nama}, ${urlRevisi}`,
        },
        body: teks,
      });
      hasil[p.kunci] = r.status;
    } catch { hasil[p.kunci] = 0; }
  }
  return hasil;
}
const sukses = (h: Record<string, number>, k: string) => h[k] >= 200 && h[k] < 300;
// penambahan item (pesanan susulan untuk lokasi yang sudah memesan): alasannya disimpan sebagai baris pertama kolom memo dengan awalan ini
const MARKER = 'PENAMBAHAN ITEM: ';
const ambilTambahan = (memo: unknown) => { const r = String(memo ?? '').split('\n').find((l) => l.startsWith(MARKER)); return r ? r.slice(MARKER.length).trim() : ''; };
// alamat gambar halaman ke-i surat di Supabase Storage (bucket publik, folder acak) dan jumlah halamannya, dari tautan penampil surat
const halamanKe = (urlSurat: string, i: number) => {
  try { const f = new URL(urlSurat).searchParams.get('f'); return f && /^\d+-[a-f0-9]{24}$/.test(f) ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${f}/${String(i).padStart(2, '0')}.jpg` : ''; } catch { return ''; }
};
const jumlahHalaman = (urlSurat: string) => { try { const n = Math.floor(Number(new URL(urlSurat).searchParams.get('n'))); return n >= 1 && n <= 60 ? n : 1; } catch { return 1; } };
// tanda tangan HMAC untuk tautan tombol ◄ ► ntfy (diperiksa fungsi ntfy-halaman); kuncinya rahasia yang sama dengan webhook Telegram
const kunciHal = () => Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || Deno.env.get('N8N_TOKEN') || '';
async function tandaHal(teks: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(kunciHal()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(teks)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
const folderSurat = (urlSurat: string) => { try { const f = new URL(urlSurat).searchParams.get('f') ?? ''; return /^\d+-[a-f0-9]{24}$/.test(f) ? f : ''; } catch { return ''; } };
const kunciNama = (n: string) => String(n).toUpperCase().replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const { lokasi_form, bagian, memo, halaman, jpg, ploting } = body ?? {};
  const penambahan = body?.penambahan === true, alasan = String(body?.alasan ?? '').replace(/\s+/g, ' ').trim();
  // pengingat harian ke pimpinan yang belum memutuskan; dipanggil terjadwal (pg_cron) dengan header X-Token = N8N_TOKEN
  if (body?.pengingat_pimpinan) {
    const tokenSah = Deno.env.get('N8N_TOKEN') ?? '';
    if (!tokenSah || req.headers.get('x-token') !== tokenSah) return balas({ error: 'Tidak diizinkan' }, 401);
    const dbP = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const batas = new Date(Date.now() - 20 * 3600_000).toISOString();
    const { data: sem } = await dbP.from('permintaan').select('*').lte('dibuat', batas).not('lampiran_url', 'is', null).neq('status', 'ditolak').neq('status', 'disetujui').order('dibuat');
    const ringkas: Record<string, number> = {};
    for (const k of PIMPINAN) {
      const mereka = (sem ?? []).filter((p: any) => (p['status_' + k.kunci] ?? p.status ?? 'menunggu') === 'menunggu');
      ringkas[k.kunci] = mereka.length;
      for (const p of mereka.slice(0, 5)) {
        const tJ = Number(p.total_jual) || 0, tB = Number(p.total_beli) || 0, rabU = Number(p.rab) || 0, sisaU = Number(p.untung) - (tJ - tB);
        const hari = Math.max(1, Math.floor((Date.now() - Date.parse(p.dibuat)) / 86400_000));
        await kirimNotif({ id: p.id, client: p.client, bagian: p.bagian_kerja, target: p.jumlah_anggota, rab: rabU, terpakai: rabU - sisaU - tJ, tJual: tJ, sisa: sisaU, tBeli: tB, untung: Number(p.untung) || 0,
          pengingat: `hari ke-${hari}`, tambahan: ambilTambahan(p.memo), catatan: p.memo ?? '', baris: (p.items ?? []).map((b: any) => ({ nama: b.nama, qty: b.qty, beli: b.beli, jual: b.jual })),
          urlSurat: p.lampiran_url, token: { yasir: p.token_yasir, ferry: p.token_ferry } }, [k.kunci], false);
      }
      if (mereka.length > 5) {
        const lain = mereka.slice(5).map((p: any) => `- ${p.client} (${p.bagian_kerja})`).join('\n');
        try { await fetch(`https://ntfy.sh/${k.topik()}`, { method: 'POST', headers: { Title: kodekan(`${k.nama}: ${mereka.length - 5} permintaan lain masih menunggu`), Priority: '3', Tags: 'hourglass' }, body: lain.slice(0, 3000) }); } catch { /* abaikan */ }
      }
    }
    return balas({ ok: true, menunggu: ringkas });
  }
  // kirim ulang notifikasi ntfy untuk permintaan yang sudah tersimpan tetapi notifikasinya gagal (tanpa membuat permintaan baru)
  if (body?.kirim_ulang) {
    const idUlang = Number(body.kirim_ulang);
    if (!Number.isInteger(idUlang)) return balas({ error: 'Nomor permintaan tidak valid' }, 400);
    const dbU = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await adalahAdmin(dbU, req))) return balas({ error: 'Perlu login admin' }, 401);
    const { data: p } = await dbU.from('permintaan').select('*').eq('id', idUlang).maybeSingle();
    if (!p) return balas({ error: 'Permintaan tidak ditemukan' }, 404);
    if (!p.lampiran_url) return balas({ error: 'Surat permintaan ini belum tersimpan, buat ulang permintaannya' }, 409);
    const tunggu = PIMPINAN.filter((k) => p['terkirim_' + k.kunci] !== true && (p['status_' + k.kunci] ?? p.status ?? 'menunggu') === 'menunggu').map((k) => k.kunci);
    if (!tunggu.length) return balas({ error: 'Semua notifikasi sudah terkirim atau permintaan sudah diputuskan' }, 409);
    const tJ = Number(p.total_jual) || 0, tB = Number(p.total_beli) || 0, rabU = Number(p.rab) || 0, sisaU = Number(p.untung) - (tJ - tB);
    const hasilU = await kirimNotif({ id: p.id, client: p.client, bagian: p.bagian_kerja, target: p.jumlah_anggota, rab: rabU, terpakai: rabU - sisaU - tJ,
      tJual: tJ, sisa: sisaU, tBeli: tB, untung: Number(p.untung) || 0, tambahan: ambilTambahan(p.memo), catatan: p.memo ?? '',
      baris: (p.items ?? []).map((b: any) => ({ nama: b.nama, qty: b.qty, beli: b.beli, jual: b.jual })),
      urlSurat: p.lampiran_url, token: { yasir: p.token_yasir, ferry: p.token_ferry } }, tunggu);
    const upd: Record<string, boolean> = {};
    for (const k of tunggu) upd['terkirim_' + k] = sukses(hasilU, k);
    const semua = PIMPINAN.every((k) => (('terkirim_' + k.kunci) in upd ? upd['terkirim_' + k.kunci] : p['terkirim_' + k.kunci] === true));
    await dbU.from('permintaan').update({ ...upd, terkirim: semua }).eq('id', p.id);
    if (!semua) return balas({ error: 'Notifikasi masih gagal terkirim ke ' + PIMPINAN.filter((k) => tunggu.includes(k.kunci) && !sukses(hasilU, k.kunci)).map((k) => k.nama).join(' dan '), id: p.id }, 502);
    return balas({ ok: true, id: p.id, ntfy: hasilU });
  }
  let items = body?.items;
  // lampiran: satu gambar JPG per halaman surat (`halaman`); `jpg` (satu gambar) tetap diterima agar versi web lama tidak rusak
  const gambar: string[] = Array.isArray(halaman) ? halaman.map(String) : jpg ? [String(jpg)] : [];
  // pembagian seragam per karyawan (`ploting`): jumlah tiap item dihitung ulang di sini dari pembagian, bukan dari `items` kiriman web
  const rincian: { nama: string; item_no: number; qty: number; baju: string | null; celana: string | null; sepatu: string | null }[] = [];
  if (Array.isArray(ploting) && ploting.length) {
    if (ploting.length > 3000) return balas({ error: 'Pembagian seragam terlalu besar' }, 413);
    const per = new Map<number, number>(), sudahAda = new Set<string>();
    for (const x of ploting) {
      const no = Number(x?.item_no), qty = Math.floor(Number(x?.qty)), nama = String(x?.nama ?? '').trim();
      if (!Number.isInteger(no) || !(qty > 0) || !nama || nama.length > 200) return balas({ error: 'Data pembagian seragam tidak valid' }, 400);
      const kunci = kunciNama(nama) + '|' + no;
      if (sudahAda.has(kunci)) return balas({ error: `${nama} tercantum dua kali untuk seragam yang sama dalam satu permintaan` }, 400);
      sudahAda.add(kunci);
      per.set(no, (per.get(no) ?? 0) + qty);
      rincian.push({ nama, item_no: no, qty, baju: String(x?.baju ?? '').slice(0, 12) || null, celana: String(x?.celana ?? '').slice(0, 12) || null, sepatu: String(x?.sepatu ?? '').slice(0, 12) || null });
    }
    items = [...per.entries()].map(([no, qty]) => ({ no, qty }));
  }
  if (!lokasi_form || !bagian || !Array.isArray(items) || !items.length || !gambar.length)
    return balas({ error: 'Data permintaan belum lengkap' }, 400);
  if (gambar.length > 40 || gambar.some((g) => !g.startsWith('/9j/'))) return balas({ error: 'Gambar tidak valid' }, 400);
  if (items.length > 100 || gambar.reduce((a, g) => a + g.length, 0) > 14_000_000) return balas({ error: 'Permintaan terlalu besar' }, 413);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (!(await adalahAdmin(db, req))) return balas({ error: 'Perlu login admin untuk mengirim permintaan. Masuk dulu di halaman web.' }, 401);
  // penambahan item: wajib beralasan, dan bagian itu harus sudah punya permintaan yang tidak ditolak (kalau belum, pakai permintaan biasa)
  if (penambahan) {
    if (alasan.length < 5 || alasan.length > 500) return balas({ error: 'Keterangan penambahan (alasan) wajib diisi, 5 sampai 500 huruf' }, 400);
    const { data: pl } = await db.from('permintaan').select('id,status,status_yasir,status_ferry').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian);
    if (!(pl ?? []).some((p: any) => ![p.status, p.status_yasir, p.status_ferry].includes('ditolak'))) return balas({ error: 'Bagian ini belum punya permintaan aktif, jadi bukan penambahan. Buat permintaan baru biasa.' }, 409);
  }
  // batasi jumlah kiriman supaya pimpinan tidak kebanjiran notifikasi
  const { count: baruSaja } = await db.from('permintaan').select('id', { count: 'exact', head: true }).gte('dibuat', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((baruSaja ?? 0) >= 20) return balas({ error: 'Terlalu banyak permintaan dalam 10 menit terakhir, coba lagi nanti' }, 429);

  // orang yang sama tidak boleh dipesankan seragam yang sama dua kali selama permintaan sebelumnya masih aktif (menunggu/disetujui)
  let penerimaAktif = new Set<string>();
  if (rincian.length) {
    const [{ data: sebelumnya }, { data: permLama }] = await Promise.all([
      db.from('ploting').select('nama,item_no,permintaan_id').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian).limit(5000),
      db.from('permintaan').select('id,status,status_yasir,status_ferry').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian),
    ]);
    const mati = new Set((permLama ?? []).filter((p: any) => [p.status, p.status_yasir, p.status_ferry].includes('ditolak')).map((p: any) => p.id));
    const aktif = new Set((sebelumnya ?? []).filter((r: any) => !mati.has(r.permintaan_id)).map((r: any) => kunciNama(r.nama) + '|' + r.item_no));
    penerimaAktif = new Set((sebelumnya ?? []).filter((r: any) => !mati.has(r.permintaan_id)).map((r: any) => kunciNama(r.nama)));
    const ganda = [...new Set(rincian.filter((r) => aktif.has(kunciNama(r.nama) + '|' + r.item_no)).map((r) => r.nama))];
    // nama yang ejaannya mirip dengan orang yang sudah dipesan (mis. salah ketik) dianggap kemungkinan orang yang sama: minta konfirmasi
    const jarak = (x: string, y: string) => { const d = Array.from({ length: y.length + 1 }, (_, j) => j); for (let i = 1; i <= x.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= y.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = t; } } return d[y.length]; };
    const mirip: string[] = [];
    if (!ganda.length && body?.lanjut_mirip !== true) {
      for (const r of rincian) { const k = kunciNama(r.nama); if (k.length < 6) continue; for (const e of aktif) { const [nm, no] = e.split('|'); if (Number(no) !== r.item_no || nm === k || Math.abs(nm.length - k.length) > 2) continue; if (jarak(nm, k) <= 2) { mirip.push(`${r.nama} ~ ${nm}`); break; } } }
      if (mirip.length) return balas({ error: `Nama berikut sangat mirip dengan orang yang sudah dipesankan seragam yang sama (kemungkinan orang yang sama, salah ketik): ${[...new Set(mirip)].slice(0, 6).join('; ')}.`, perlu_konfirmasi: 'mirip' }, 409);
    }
    if (ganda.length) return balas({ error: `Sudah ada permintaan aktif untuk seragam yang sama atas nama: ${ganda.slice(0, 8).join(', ')}${ganda.length > 8 ? ` dan ${ganda.length - 8} lainnya` : ''}. Periksa daftar permintaan; bila permintaan lama ditolak/revisi, kirim ulang setelah itu.`, ganda }, 409);
  }

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
  // sisa RAB = anggaran - total JUAL; penjualan permintaan sebelumnya pada lokasi + bagian yang sama ikut mengurangi RAB (yang ditolak/revisi tidak dihitung)
  // untung = sisa RAB + (jual - beli)
  const { data: lalu } = await db.from('permintaan').select('total_jual').eq('lokasi_form', lokasi_form).eq('bagian_kerja', bagian).or('status.is.null,status.neq.ditolak');
  // peralatan yang memakai anggaran seragam bagian ini ikut mengurangi RAB
  const { data: per } = await db.rpc('peralatan_terpakai_seragam');
  const dariPeralatan = (per ?? []).filter((x: any) => x.lokasi_form === lokasi_form && x.bagian_kerja === bagian).reduce((a: number, x: any) => a + Number(x.jual || 0), 0);
  const terpakai = (lalu ?? []).reduce((a: number, x: any) => a + Number(x.total_jual || 0), 0) + dariPeralatan;
  const sisa = rab - terpakai - tJual, untung = sisa + (tJual - tBeli);
  // penerima melebihi jumlah anggota, atau belanja melampaui RAB: harus dikonfirmasi eksplisit (web menanyakan lalu mengirim ulang dengan lanjut_*)
  const peringatan: string[] = [];
  if (rincian.length) {
    const unik = new Set([...penerimaAktif, ...rincian.map((r) => kunciNama(r.nama))]);
    if (unik.size > Number(prog.target)) {
      if (body?.lanjut_target !== true) return balas({ error: `Penerima seragam (${unik.size} orang, termasuk yang sudah dipesan sebelumnya) melebihi jumlah anggota bagian ini (${prog.target}).`, perlu_konfirmasi: 'target' }, 409);
      peringatan.push(`PERHATIAN: penerima ${unik.size} orang melebihi jumlah anggota (${prog.target})`);
    }
  }
  if (sisa < 0) {
    if (body?.lanjut_rab !== true) return balas({ error: `Belanja ini melampaui RAB sebesar ${rp(-sisa)} (untung ${rp(untung)}).`, perlu_konfirmasi: 'rab' }, 409);
    peringatan.push(`PERHATIAN: melampaui RAB ${rp(-sisa)}`);
  }
  const catatan = [penambahan ? MARKER + alasan : '', ...peringatan, penambahan ? '' : String(memo ?? '').slice(0, 1000)].filter(Boolean).join('\n').slice(0, 1200);

  // token sekali-pakai per permintaan DAN per pimpinan: hanya penerima notifikasi yang punya tautan keputusannya
  const token: Record<string, string> = { yasir: acak(), ferry: acak() };
  const { data: baru, error: eIns } = await db.from('permintaan').insert({
    lokasi_form, client: prog.client, bagian_kerja: bagian, jumlah_anggota: prog.target, rab,
    items: baris, total_beli: tBeli, total_jual: tJual, untung, memo: catatan,
    token_yasir: token.yasir, token_ferry: token.ferry,
  }).select('id').single();
  if (eIns) return balas({ error: 'Gagal menyimpan permintaan' }, 500);
  // pembagian per karyawan ikut tersimpan bersama permintaan (halaman Ploting dipakai untuk koreksi setelah disetujui)
  if (rincian.length) {
    const { error: ePl } = await db.from('ploting').insert(rincian.map((r) => ({
      permintaan_id: baru.id, lokasi_form, bagian_kerja: bagian, nama: r.nama.slice(0, 200), item_no: r.item_no,
      item_nama: baris.find((b) => b.no === r.item_no)?.nama ?? '', qty: r.qty, ukuran_baju: r.baju, ukuran_celana: r.celana, ukuran_sepatu: r.sepatu,
    })));
    if (ePl) { await db.from('permintaan').delete().eq('id', baru.id); return balas({ error: 'Gagal menyimpan pembagian seragam, permintaan dibatalkan' }, 500); }
    await db.from('permintaan').update({ diploting_pada: new Date().toISOString() }).eq('id', baru.id);
  }

  // ntfy.sh gratis membatasi lampiran 2 MB per file, dan penampil gambar HP menciutkan gambar yang sangat panjang sehingga huruf pecah.
  // Jadi tiap halaman disimpan di Supabase Storage (folder acak, tidak bisa ditebak) dan notifikasi membuka halaman web surat
  // (surat.html) yang menampilkan semua halaman selebar layar. Tidak ada lampiran gambar di notifikasi.
  const folder = `${baru.id}-${acak().slice(0, 24)}`;
  for (let i = 0; i < gambar.length; i++) {
    const { error: eUp } = await db.storage.from('lampiran-surat').upload(`${folder}/${String(i + 1).padStart(2, '0')}.jpg`,
      Uint8Array.from(atob(gambar[i]), (c) => c.charCodeAt(0)), { contentType: 'image/jpeg', upsert: false });
    if (eUp) return balas({ error: `Tersimpan (no. ${baru.id}) tetapi halaman surat gagal disimpan`, id: baru.id }, 500);
  }
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  const urlSurat = `${WEB}/surat.html?f=${folder}&n=${gambar.length}&j=${encodeURIComponent(`${prog.client} - ${bagian}`)}`;
  await db.from('permintaan').update({ lampiran_url: urlSurat }).eq('id', baru.id);
  // posisi kolom tanda tangan pimpinan pada halaman surat (pecahan 0-1), untuk tanda tangan digital di surat.html
  const pecah = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; };
  const ttdPos = (Array.isArray(body?.ttd_pos) ? body.ttd_pos : []).slice(0, 12).map((t: any) => ({
    hal: Math.floor(Number(t?.hal)), p: String(t?.p), x: pecah(t?.x), y: pecah(t?.y), w: pecah(t?.w), h: pecah(t?.h), cy: pecah(t?.cy), fs: pecah(t?.fs),
  })).filter((t: any) => (t.p === 'yasir' || t.p === 'ferry') && t.hal >= 1 && t.hal <= gambar.length && [t.x, t.y, t.w, t.h, t.cy, t.fs].every((v) => v !== null));
  if (ttdPos.length) await db.from('permintaan').update({ ttd_pos: ttdPos }).eq('id', baru.id);

  const hasil = await kirimNotif({ id: baru.id, client: prog.client, bagian, target: prog.target, rab, terpakai, tJual, sisa, tBeli, untung, catatan, tambahan: penambahan ? alasan : '', baris, urlSurat, token }, PIMPINAN.map((p) => p.kunci));
  const ok = (k: string) => sukses(hasil, k);
  await db.from('permintaan').update({ terkirim_yasir: ok('yasir'), terkirim_ferry: ok('ferry'), terkirim: ok('yasir') && ok('ferry') }).eq('id', baru.id);
  if (!(ok('yasir') && ok('ferry'))) {
    const gagal = PIMPINAN.filter((p) => !ok(p.kunci)).map((p) => p.nama).join(' dan ');
    return balas({ error: `Tersimpan (no. ${baru.id}) tetapi notifikasi ke ${gagal} gagal terkirim`, id: baru.id }, 502);
  }
  return balas({ ok: true, id: baru.id, ntfy: hasil });
});
