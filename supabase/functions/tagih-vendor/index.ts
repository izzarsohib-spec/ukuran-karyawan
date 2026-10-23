// Menagih kepastian kirim ke vendor dan mengingatkan deadline lewat WhatsApp (n8n -> WAHA), memakai data kekurangan dari database.
// Yang dikirim ke vendor: SATU berkas PDF ber-kop surat (tabel kekurangan per barang dan ukuran) + keterangan WhatsApp yang singkat.
// PDF dibuat di sini (satu tempat) dan disimpan di Storage publik dengan folder acak, jadi tombol manual dan pengingat otomatis memakai dokumen yang sama.
// Dipanggil dengan dua cara:
//  - dari web oleh admin yang login (aksi: pratinjau | kirim)
//  - oleh n8n terjadwal dengan header X-Token = N8N_TOKEN (aksi: otomatis_siapkan | otomatis_tandai); n8n sendiri yang mengirim ke WAHA.
// Rahasia: N8N_WEBHOOK_URL dan N8N_TOKEN (sama dengan fungsi ingatkan-pic).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const balas = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const noWa = (t: string) => { const d = String(t ?? '').replace(/\D/g, ''); return !d ? '' : d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };
const acak = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const PENANDATANGAN = ['Shohib Izzar', 'PIC Seragam'];

async function adalahAdmin(db: any, req: Request): Promise<boolean> {
  const t = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const { data, error } = await db.auth.getUser(t);
  if (error || !data?.user) return false;
  const { data: a } = await db.from('admin_pengguna').select('user_id').eq('user_id', data.user.id).eq('aktif', true).maybeSingle();
  return !!a;
}

// ---- tanggal (WIB) ----
const hariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const selisihHari = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400_000);
const tglPanjang = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const ketHari = (s: number) => (s > 1 ? `${s} hari lagi` : s === 1 ? 'besok' : s === 0 ? 'hari ini' : `terlambat ${-s} hari`);

// ---- nama komponen barang (sama dengan komponenBarang di web): setelan dipecah jadi baju + celana ----
const dasar = (n: string) => n.replace(/\s*\(BAJU SAJA\)/g, '').replace(/^(SERAGAM|ATASAN|BAJU|CELANA|SETELAN)\s+/, '').trim() || n;
function labelKomponen(nama: string, jenis: string): string {
  const n = String(nama).toUpperCase().trim();
  if (jenis === 'sepatu' || /^SETELAN/.test(n)) return n;
  if (jenis === 'baju') return /^KAOS\b/.test(n) ? n : 'BAJU ' + dasar(n);
  return 'CELANA ' + dasar(n);
}
const namaRapi = (s: string) => String(s || '').toLowerCase().replace(/[^\s,()/+.-]+/g, (w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
const NAMA_GRUP: Record<string, string> = { baju: 'Baju', celana: 'Celana', sepatu: 'Sepatu' };

type Baris = { item_no: number; item_nama: string; jenis: string; ukuran: string; dipesan: number; diterima: number };
type Barang = { grup: string; label: string; dipesan: number; diterima: number; kurang: number; ukuran: { uk: string; kurang: number }[] };

// gabungkan baris per item + ukuran menjadi barang per komponen; kekurangan dijumlah per ukuran (kelebihan satu ukuran tidak menutup kurang ukuran lain)
function susunKekurangan(baris: Baris[]): Barang[] {
  const peta = new Map<string, { grup: string; label: string; dipesan: number; diterima: number; uk: Map<string, number> }>();
  for (const b of baris) {
    const grup = NAMA_GRUP[b.jenis]; if (!grup) continue;
    const label = labelKomponen(b.item_nama, b.jenis), k = grup + '|' + label;
    if (!peta.has(k)) peta.set(k, { grup, label, dipesan: 0, diterima: 0, uk: new Map() });
    const x = peta.get(k)!; x.dipesan += Number(b.dipesan); x.diterima += Number(b.diterima);
    x.uk.set(b.ukuran, (x.uk.get(b.ukuran) ?? 0) + Number(b.dipesan) - Number(b.diterima));
  }
  const urutUk = (a: string, b: string) => { const o = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'L4', 'L5', 'L6', 'L7'], ia = o.indexOf(a), ib = o.indexOf(b); if (ia >= 0 && ib >= 0) return ia - ib; const na = parseFloat(a), nb = parseFloat(b); return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b, 'id', { numeric: true }); };
  return [...peta.values()].map((x) => {
    const ukuran = [...x.uk.entries()].map(([uk, s]) => ({ uk, kurang: Math.max(0, s) })).filter((u) => u.kurang > 0).sort((a, b) => urutUk(a.uk, b.uk));
    return { grup: x.grup, label: x.label, dipesan: x.dipesan, diterima: x.diterima, kurang: ukuran.reduce((a, u) => a + u.kurang, 0), ukuran };
  }).filter((b) => b.kurang > 0).sort((a, b) => ['Baju', 'Celana', 'Sepatu'].indexOf(a.grup) - ['Baju', 'Celana', 'Sepatu'].indexOf(b.grup) || a.label.localeCompare(b.label, 'id'));
}

// keterangan WhatsApp yang menyertai PDF (singkat; rincian ada di PDF)
function susunKeterangan(vendorNama: string, jenis: 'tagih' | 'ingatkan', barang: Barang[], janji: string | null): string {
  const nama = vendorNama.split(' ')[0], total = barang.reduce((a, b) => a + b.kurang, 0), tgl = tglPanjang(hariIni());
  if (jenis === 'ingatkan' && janji) {
    return `Halo Mas ${nama}, pengingat dari PT. Ray Mitra Perkasa: pengiriman seragam dijanjikan tanggal ${tglPanjang(janji)} (${ketHari(selisihHari(janji, hariIni()))}). Sisa yang belum kami terima per ${tgl}: ${total} pcs (${barang.length} jenis barang), rincian ada di PDF terlampir. Mohon dipastikan terkirim sesuai tanggal tersebut, atau kabari kami bila ada perubahan. Terima kasih.`;
  }
  return `Halo Mas ${nama}, kami dari PT. Ray Mitra Perkasa. Mohon kepastian pengiriman seragam yang belum kami terima per ${tgl}: ${total} pcs (${barang.length} jenis barang), rincian ada di PDF terlampir. Mohon info kapan masing-masing bisa dikirim (tanggal dan jumlahnya). Terima kasih.`;
}

// ---- PDF ber-kop surat ----
async function buatPdf(o: { vendor: string; jenis: 'tagih' | 'ingatkan'; barang: Barang[]; janji: string | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold), ital = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const PW = 595.28, PH = 841.89, L = 40, R = PW - 40, W = R - L, BAWAH = 742, BIRU = rgb(0, 0.44, 0.75), Y = (t: number) => PH - t;
  const WEB = Deno.env.get('WEB_URL') ?? 'https://izzarsohib-spec.github.io/ukuran-karyawan';
  const gambar = async (u: string) => { try { const r = await fetch(u); return r.ok ? await doc.embedPng(new Uint8Array(await r.arrayBuffer())) : null; } catch { return null; } };
  const [kop, kaki] = await Promise.all([gambar(WEB + '/aset/kop-surat.png'), gambar(WEB + '/aset/kaki-surat.png')]);
  let page = doc.addPage([PW, PH]), y = 100;
  const hiasan = () => {
    if (kop) page.drawImage(kop, { x: L, y: Y(14) - (W * 112) / 1030, width: W, height: (W * 112) / 1030 });
    if (kaki) page.drawImage(kaki, { x: L, y: Y(758) - (W * 92) / 1030, width: W, height: (W * 92) / 1030 });
    page.drawLine({ start: { x: L, y: Y(74) }, end: { x: R, y: Y(74) }, thickness: 2.2, color: BIRU });
    page.drawLine({ start: { x: L, y: Y(752) }, end: { x: R, y: Y(752) }, thickness: 2.2, color: BIRU });
    const tengah = (s: string, yy: number, f = reg, c = rgb(0, 0, 0)) => page.drawText(s, { x: PW / 2 - f.widthOfTextAtSize(s, 9.5) / 2, y: Y(yy), size: 9.5, font: f, color: c });
    tengah('HEAD OFFICE :', 768, bold, rgb(1, 0, 0)); tengah('Jl. Sidodadi RT. 03 RW. 04 Kel. Mijen Kec. Mijen Semarang', 781);
    tengah('Telp. 024-76640213, 085 848484 222 - 085641220696', 794); tengah('Email : raymitraperkasa@yahoo.co.id', 807, reg, rgb(0, 0, 1));
  };
  hiasan();
  const baru = () => { page = doc.addPage([PW, PH]); hiasan(); y = 100; };
  const bungkus = (s: string, f: any, size: number, lebar: number): string[] => {
    const out: string[] = []; let baris = '';
    for (const kata of String(s).split(/\s+/)) { const coba = baris ? baris + ' ' + kata : kata; if (f.widthOfTextAtSize(coba, size) > lebar && baris) { out.push(baris); baris = kata; } else baris = coba; }
    if (baris) out.push(baris); return out.length ? out : [''];
  };
  const paragraf = (s: string, f = reg, size = 10.5) => { for (const b of bungkus(s, f, size, W)) { if (y + 14 > BAWAH) baru(); page.drawText(b, { x: L, y: Y(y), size, font: f }); y += 14; } };
  const pusat = (s: string, size: number, f = bold) => { page.drawText(s, { x: PW / 2 - f.widthOfTextAtSize(s, size) / 2, y: Y(y), size, font: f }); };

  const judul = o.jenis === 'ingatkan' ? 'PENGINGAT DEADLINE PENGIRIMAN SERAGAM' : 'PERMINTAAN KEPASTIAN PENGIRIMAN SERAGAM';
  pusat(judul, 13); y += 28;
  const total = o.barang.reduce((a, b) => a + b.kurang, 0);
  for (const [k, v] of [['Tanggal', tglPanjang(hariIni())], ['Kepada', o.vendor], ['Perihal', 'Rekapitulasi kekurangan barang yang belum diterima']]) { page.drawText(k, { x: L, y: Y(y), size: 10.5, font: bold }); page.drawText(': ' + v, { x: L + 52, y: Y(y), size: 10.5, font: reg }); y += 14; }
  y += 8;
  paragraf(o.jenis === 'ingatkan' && o.janji
    ? `Menindaklanjuti kesepakatan, pengiriman dijanjikan tanggal ${tglPanjang(o.janji)} (${ketHari(selisihHari(o.janji, hariIni()))}). Berikut sisa barang yang belum kami terima sampai dengan tanggal surat ini, sejumlah ${total} pcs.`
    : `Berikut barang yang telah kami pesan tetapi belum kami terima sampai dengan tanggal surat ini, sejumlah ${total} pcs. Mohon konfirmasi kapan masing-masing dapat dikirim (tanggal dan jumlahnya).`);
  y += 8;

  // tabel
  const kol = [28, 150, 172, 55, 55, 55], xs = kol.map((_, i) => L + kol.slice(0, i).reduce((p, q) => p + q, 0));
  const garis = rgb(0, 0, 0);
  const sel = (i: number, h: number, teks: string[], f: any, size: number, rata: 'l' | 'c' | 'r', isi?: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x: xs[i], y: Y(y) - h + 0, width: kol[i], height: h, borderColor: garis, borderWidth: 0.5, color: isi });
    teks.forEach((t, n) => { const lw = f.widthOfTextAtSize(t, size), x = rata === 'c' ? xs[i] + (kol[i] - lw) / 2 : rata === 'r' ? xs[i] + kol[i] - lw - 4 : xs[i] + 4; page.drawText(t, { x, y: Y(y) - 11 - n * 12.5, size, font: f }); });
  };
  const baris = (isi: { t: string; rata?: 'l' | 'c' | 'r' }[], f = reg, size = 9.5, fill?: ReturnType<typeof rgb>) => {
    const bagi = isi.map((c, i) => bungkus(c.t, f, size, kol[i] - 8)), h = Math.max(...bagi.map((b) => b.length)) * 12.5 + 5;
    if (y + h > BAWAH) { baru(); kepala(); }
    bagi.forEach((b, i) => sel(i, h, b, f, size, isi[i].rata ?? 'l', fill)); y += h;
  };
  const kepala = () => baris(['NO', 'NAMA BARANG', 'UKURAN YANG KURANG', 'DIPESAN', 'DITERIMA', 'KURANG'].map((t) => ({ t, rata: 'c' as const })), bold, 9.5, rgb(0.93, 0.93, 0.93));
  const gabungBaris = (teks: string, f: any, fill?: ReturnType<typeof rgb>) => {
    if (y + 17 > BAWAH) { baru(); kepala(); }
    page.drawRectangle({ x: L, y: Y(y) - 17, width: W, height: 17, borderColor: garis, borderWidth: 0.5, color: fill }); page.drawText(teks, { x: L + 4, y: Y(y) - 12, size: 9.5, font: f }); y += 17;
  };
  kepala(); let no = 0;
  for (const g of ['Baju', 'Celana', 'Sepatu']) {
    const l = o.barang.filter((b) => b.grup === g); if (!l.length) continue;
    gabungBaris(g.toUpperCase(), bold, rgb(0.97, 0.97, 0.97));
    for (const b of l) baris([{ t: String(++no), rata: 'c' }, { t: namaRapi(b.label) }, { t: b.ukuran.map((u) => `${u.uk}: ${u.kurang}`).join(', ') }, { t: String(b.dipesan), rata: 'c' }, { t: String(b.diterima), rata: 'c' }, { t: String(b.kurang), rata: 'c' }]);
  }
  baris([{ t: '' }, { t: 'TOTAL KEKURANGAN', rata: 'r' }, { t: '' }, { t: String(o.barang.reduce((a, b) => a + b.dipesan, 0)), rata: 'c' }, { t: String(o.barang.reduce((a, b) => a + b.diterima, 0)), rata: 'c' }, { t: String(total), rata: 'c' }], bold);
  y += 14;
  if (o.jenis === 'ingatkan' && o.janji) { paragraf(`Tanggal janji kirim: ${tglPanjang(o.janji)} (${ketHari(selisihHari(o.janji, hariIni()))}).`, bold); y += 4; }
  paragraf('Mohon dipastikan pengiriman sesuai jadwal, atau kabari kami bila ada perubahan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.');
  y += 10;
  if (y + 90 > BAWAH) baru();
  page.drawText('Hormat kami,', { x: L, y: Y(y), size: 10.5, font: reg });
  const ny = y + 62; page.drawText(PENANDATANGAN[0], { x: L, y: Y(ny), size: 10.5, font: bold }); page.drawLine({ start: { x: L, y: Y(ny + 2) }, end: { x: L + bold.widthOfTextAtSize(PENANDATANGAN[0], 10.5), y: Y(ny + 2) }, thickness: 0.6 });
  page.drawText('(' + PENANDATANGAN[1] + ')', { x: L, y: Y(ny + 14), size: 9, font: ital, color: rgb(0.45, 0.45, 0.45) });
  return await doc.save();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return balas({ error: 'Metode tidak didukung' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return balas({ error: 'Data tidak terbaca' }, 400); }
  const aksi = String(body?.aksi ?? '');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const tokenN8n = Deno.env.get('N8N_TOKEN'), urlN8n = Deno.env.get('N8N_WEBHOOK_URL');
  const dariN8n = !!tokenN8n && (req.headers.get('x-token') ?? '') === tokenN8n;

  async function kekurangan(vendorId: number) {
    const { data, error } = await db.rpc('kekurangan_vendor_dasar', { p_vendor: vendorId });
    if (error) throw new Error('Gagal menghitung kekurangan: ' + error.message);
    return susunKekurangan((data ?? []) as Baris[]);
  }
  // buat PDF lalu simpan di Storage publik (folder acak, tidak bisa ditebak); mengembalikan tautan
  async function simpanPdf(vendorId: number, vendor: string, jenis: 'tagih' | 'ingatkan', barang: Barang[], janji: string | null) {
    const bytes = await buatPdf({ vendor, jenis, barang, janji });
    const nama = `${jenis === 'ingatkan' ? 'pengingat' : 'kekurangan'}-seragam-${hariIni()}.pdf`, jalur = `vendor-${vendorId}-${acak().slice(0, 24)}/${nama}`;
    const { error } = await db.storage.from('lampiran-surat').upload(jalur, bytes, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error('Gagal menyimpan PDF: ' + error.message);
    return { url: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${jalur}`, nama };
  }

  // ---------- jalur n8n terjadwal ----------
  if (aksi === 'otomatis_siapkan' || aksi === 'otomatis_tandai') {
    if (!dariN8n) return balas({ error: 'Tidak diizinkan' }, 401);
    if (aksi === 'otomatis_tandai') {
      const id = Number(body?.tagih_id), janji = String(body?.janji ?? '');
      if (!Number.isInteger(id) || !/^\d{4}-\d{2}-\d{2}$/.test(janji)) return balas({ error: 'Data tidak valid' }, 400);
      const { data: t } = await db.from('tagih_vendor').select('jumlah_pengingat,pengingat_oto_untuk').eq('id', id).maybeSingle();
      if (t && t.pengingat_oto_untuk !== janji) await db.from('tagih_vendor').update({ pengingat_oto_untuk: janji, jumlah_pengingat: (t.jumlah_pengingat ?? 0) + 1, terakhir_diingatkan: new Date().toISOString() }).eq('id', id);
      return balas({ ok: true });
    }
    const { data: aktif } = await db.from('tagih_vendor').select('id,vendor_id,janji_kirim,tgl_janji_dicatat,pengingat_oto_untuk').eq('status', 'dijanjikan').not('janji_kirim', 'is', null);
    const pesan: any[] = [], lewat: any[] = [], hari = hariIni();
    for (const t of aktif ?? []) {
      const sisaHari = selisihHari(t.janji_kirim, hari), hariPengingat = selisihHari(t.janji_kirim, t.tgl_janji_dicatat ?? hari) > 3 ? 2 : 1; // deadline > 3 hari: H-2; deadline 2-3 hari: H-1
      if (sisaHari < 0 || sisaHari > hariPengingat || t.pengingat_oto_untuk === t.janji_kirim) continue;
      const { data: v } = await db.from('vendor').select('nama,telepon,aktif').eq('id', t.vendor_id).maybeSingle();
      const nomor = v ? noWa(v.telepon) : '';
      if (!v || !v.aktif || !nomor) { lewat.push({ tagih_id: t.id, alasan: 'vendor nonaktif atau nomor telepon kosong' }); continue; }
      const barang = await kekurangan(t.vendor_id);
      if (!barang.length) { await db.from('tagih_vendor').update({ status: 'selesai', selesai_pada: new Date().toISOString() }).eq('id', t.id); lewat.push({ tagih_id: t.id, alasan: 'semua sudah diterima, penagihan ditutup' }); continue; }
      try { const pdf = await simpanPdf(t.vendor_id, v.nama, 'ingatkan', barang, t.janji_kirim); pesan.push({ tagih_id: t.id, janji: t.janji_kirim, nama: v.nama, nomor, chatId: nomor + '@c.us', teks: susunKeterangan(v.nama, 'ingatkan', barang, t.janji_kirim), pdf_url: pdf.url, pdf_nama: pdf.nama }); }
      catch (e) { lewat.push({ tagih_id: t.id, alasan: String(e.message ?? e) }); }
    }
    return balas({ ok: true, pesan, dilewati: lewat });
  }

  // ---------- jalur web (admin login) ----------
  if (!(await adalahAdmin(db, req))) return balas({ error: 'Perlu login admin' }, 401);
  const vendorId = Number(body?.vendor_id);
  if (!Number.isInteger(vendorId)) return balas({ error: 'Vendor belum dipilih' }, 400);
  if (aksi !== 'pratinjau' && aksi !== 'kirim') return balas({ error: 'Aksi tidak dikenal' }, 400);
  const { data: v } = await db.from('vendor').select('id,nama,telepon,aktif').eq('id', vendorId).maybeSingle();
  if (!v) return balas({ error: 'Vendor tidak ditemukan' }, 404);
  const { data: aktif } = await db.from('tagih_vendor').select('*').eq('vendor_id', vendorId).neq('status', 'selesai').maybeSingle();
  let barang: Barang[];
  try { barang = await kekurangan(vendorId); } catch (e) { return balas({ error: String(e.message ?? e) }, 500); }
  const jenis: 'tagih' | 'ingatkan' = body?.jenis === 'tagih' ? 'tagih' : body?.jenis === 'ingatkan' ? 'ingatkan' : (aktif?.janji_kirim ? 'ingatkan' : 'tagih');
  const janji = jenis === 'ingatkan' ? aktif?.janji_kirim ?? null : null, nomor = noWa(v.telepon ?? '');
  const teks = barang.length ? susunKeterangan(v.nama, jenis, barang, janji) : '';
  const totalKurang = barang.reduce((a, b) => a + b.kurang, 0);
  if (aksi === 'pratinjau') {
    let pdf: { url: string; nama: string } | null = null;
    if (barang.length) { try { pdf = await simpanPdf(vendorId, v.nama, jenis, barang, janji); } catch (e) { return balas({ error: String(e.message ?? e) }, 500); } }
    return balas({ ok: true, jenis, vendor: { id: v.id, nama: v.nama, ada_nomor: !!nomor, aktif: v.aktif }, total_kurang: totalKurang, jumlah_barang: barang.length, teks, pdf_url: pdf?.url ?? null, pdf_nama: pdf?.nama ?? null, tagih: aktif ?? null });
  }

  if (!v.aktif) return balas({ error: 'Vendor ini nonaktif' }, 422);
  if (!nomor) return balas({ error: 'Nomor WhatsApp vendor belum diisi (Administrator > Vendor)', belum_diatur: true }, 422);
  if (!barang.length) return balas({ error: 'Tidak ada kekurangan yang perlu ditagih' }, 422);
  if (!urlN8n || !tokenN8n) return balas({ error: 'Sambungan n8n belum diatur', belum_diatur: true }, 503);
  let pdf: { url: string; nama: string };
  try { pdf = await simpanPdf(vendorId, v.nama, jenis, barang, janji); } catch (e) { return balas({ error: String(e.message ?? e) }, 500); }
  let id = aktif?.id as number | undefined;
  if (!id) { const { data: baru, error: e } = await db.from('tagih_vendor').insert({ vendor_id: vendorId }).select('id').single(); if (e) return balas({ error: 'Gagal membuat catatan penagihan' }, 500); id = baru.id; }
  try {
    const r = await fetch(urlN8n, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tokenN8n }, body: JSON.stringify({ pesan: [{ pic_id: null, nama: v.nama, nomor, chatId: nomor + '@c.us', teks, pdf_url: pdf.url, pdf_nama: pdf.nama }] }) });
    if (!r.ok) return balas({ error: `n8n menolak (HTTP ${r.status})` }, 502);
  } catch (e) { return balas({ error: 'Gagal menghubungi n8n: ' + String(e).slice(0, 160) }, 502); }
  await db.from('tagih_vendor').update({ jumlah_pengingat: (aktif?.jumlah_pengingat ?? 0) + 1, terakhir_diingatkan: new Date().toISOString() }).eq('id', id);
  return balas({ ok: true, jenis, terkirim: 1, tagih_id: id, pdf_url: pdf.url });
});
