// Menagih estimasi kirim ke vendor dan mengingatkan deadline lewat WhatsApp (n8n -> WAHA), memakai data kekurangan dari database.
// Yang dikirim ke vendor: SATU berkas PDF ber-kop surat (tiap barang berupa tabel kecil Ukuran | Qty + total) dan keterangan WhatsApp yang singkat.
// Logika (fleksibel):
//  - kekurangan = dipesan (semua permintaan disetujui, per ukuran) - diterima dari supplier; pesanan susulan otomatis menambah kekurangan.
//  - estimasi kirim dicatat PER BARANG dan melekat pada jumlah kekurangan saat dicatat (janji_vendor.qty). Kekurangan di atas jumlah itu = "tambahan baru, belum ada estimasi".
//  - estimasi yang tanggalnya lewat sementara kekurangan masih ada = "terlambat" -> vendor dimintai estimasi baru (surat jenis 'lanjutan').
// Jenis surat: tagih (minta estimasi), ingatkan (pengingat deadline), lanjutan (tindak lanjut estimasi yang terlewat).
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
const tglPanjang = (iso: string) => new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
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
type Janji = { id: number; grup: string; label: string; qty: number; tgl_dicatat: string; tgl_janji: string; catatan: string | null; pengingat_oto_untuk: string | null; lanjutan_untuk: string | null };
type Barang = {
  grup: string; label: string; dipesan: number; diterima: number; kurang: number; ukuran: { uk: string; kurang: number }[];
  janji: Janji | null; tercakup: number; baru: number; status: 'tanpa' | 'dijanjikan' | 'terlambat';
};

// gabungkan baris per item + ukuran menjadi barang per komponen; kekurangan dijumlah per ukuran (kelebihan satu ukuran tidak menutup kurang ukuran lain)
function susunKekurangan(baris: Baris[], janji: Janji[]): Barang[] {
  const peta = new Map<string, { grup: string; label: string; dipesan: number; diterima: number; uk: Map<string, number> }>();
  for (const b of baris) {
    const grup = NAMA_GRUP[b.jenis]; if (!grup) continue;
    const label = labelKomponen(b.item_nama, b.jenis), k = grup + '|' + label;
    if (!peta.has(k)) peta.set(k, { grup, label, dipesan: 0, diterima: 0, uk: new Map() });
    const x = peta.get(k)!; x.dipesan += Number(b.dipesan); x.diterima += Number(b.diterima);
    x.uk.set(b.ukuran, (x.uk.get(b.ukuran) ?? 0) + Number(b.dipesan) - Number(b.diterima));
  }
  const urutUk = (a: string, b: string) => { const o = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'L6', 'L7'], ia = o.indexOf(a), ib = o.indexOf(b); if (ia >= 0 && ib >= 0) return ia - ib; const na = parseFloat(a), nb = parseFloat(b); return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b, 'id', { numeric: true }); };
  const hari = hariIni();
  return [...peta.values()].map((x) => {
    const ukuran = [...x.uk.entries()].map(([uk, s]) => ({ uk, kurang: Math.max(0, s) })).filter((u) => u.kurang > 0).sort((a, b) => urutUk(a.uk, b.uk));
    const kurang = ukuran.reduce((a, u) => a + u.kurang, 0), j = janji.find((y) => y.grup === x.grup && y.label === x.label) ?? null;
    const tercakup = j ? Math.min(kurang, j.qty) : 0;
    return { grup: x.grup, label: x.label, dipesan: x.dipesan, diterima: x.diterima, kurang, ukuran, janji: j, tercakup, baru: kurang - tercakup,
      status: (!j ? 'tanpa' : j.tgl_janji < hari ? 'terlambat' : 'dijanjikan') as Barang['status'] };
  }).filter((b) => b.kurang > 0).sort((a, b) => ['Baju', 'Celana', 'Sepatu'].indexOf(a.grup) - ['Baju', 'Celana', 'Sepatu'].indexOf(b.grup) || a.label.localeCompare(b.label, 'id'));
}

type Jenis = 'tagih' | 'ingatkan' | 'lanjutan';
// jenis surat menurut keadaan: ada yang terlambat -> tindak lanjut; ada yang belum ada estimasi atau bertambah -> minta estimasi; selain itu pengingat
function jenisOtomatis(barang: Barang[]): Jenis {
  if (barang.some((b) => b.status === 'terlambat')) return 'lanjutan';
  if (barang.some((b) => b.status === 'tanpa' || b.baru > 0)) return 'tagih';
  return 'ingatkan';
}
const estimasiTerdekat = (barang: Barang[]) => barang.filter((b) => b.janji).map((b) => b.janji!.tgl_janji).sort()[0] ?? null;
const totalKurang = (barang: Barang[]) => barang.reduce((a, b) => a + b.kurang, 0);

function statusBarang(b: Barang): { teks: string; warna: [number, number, number] } {
  const merah: [number, number, number] = [0.75, 0.1, 0.1], oranye: [number, number, number] = [0.8, 0.45, 0], hijau: [number, number, number] = [0.1, 0.5, 0.2];
  if (!b.janji) return { teks: 'Belum ada estimasi pengiriman - mohon konfirmasi tanggalnya', warna: oranye };
  const s = selisihHari(b.janji.tgl_janji, hariIni());
  if (b.status === 'terlambat') return { teks: `Estimasi ${tglPanjang(b.janji.tgl_janji)} terlewat (${ketHari(s)}) - mohon estimasi baru`, warna: merah };
  return { teks: `Estimasi kirim: ${tglPanjang(b.janji.tgl_janji)} (${ketHari(s)})` + (b.baru > 0 ? `; tambahan ${b.baru} pcs belum ada estimasi` : ''), warna: b.baru > 0 ? oranye : hijau };
}

// keterangan WhatsApp yang menyertai PDF (singkat; rincian ada di PDF)
function susunKeterangan(vendorNama: string, jenis: Jenis, barang: Barang[]): string {
  const nama = vendorNama.split(' ')[0], total = totalKurang(barang), tgl = tglPanjang(hariIni()), jml = `${total} pcs (${barang.length} jenis barang)`;
  const dekat = estimasiTerdekat(barang);
  if (jenis === 'lanjutan') return `Halo Mas ${nama}, dari PT. Ray Mitra Perkasa. Estimasi pengiriman seragam sebelumnya belum terpenuhi seluruhnya; sisa yang belum kami terima per ${tgl}: ${jml}, rincian di PDF terlampir. Mohon estimasi pengiriman yang baru (tanggal dan jumlahnya). Terima kasih.`;
  if (jenis === 'ingatkan' && dekat) return `Halo Mas ${nama}, pengingat dari PT. Ray Mitra Perkasa: estimasi pengiriman seragam terdekat tanggal ${tglPanjang(dekat)} (${ketHari(selisihHari(dekat, hariIni()))}). Sisa yang belum kami terima per ${tgl}: ${jml}, rincian di PDF terlampir. Mohon dipastikan sesuai estimasi, atau kabari kami bila ada perubahan. Terima kasih.`;
  const tanpa = barang.filter((b) => b.status === 'tanpa').length, baru = barang.reduce((a, b) => a + (b.janji ? b.baru : 0), 0);
  const info = [tanpa ? `${tanpa} jenis barang belum ada estimasi` : '', baru ? `ada tambahan ${baru} pcs dari pesanan baru yang belum ada estimasi` : ''].filter(Boolean);
  const tambahan = info.length ? ` Catatan: ${info.join(' dan ')}.` : '';
  return `Halo Mas ${nama}, kami dari PT. Ray Mitra Perkasa. Mohon estimasi pengiriman seragam yang belum kami terima per ${tgl}: ${jml}.${tambahan} Rincian di PDF terlampir. Mohon info kapan masing-masing bisa dikirim (tanggal dan jumlahnya). Terima kasih.`;
}

// ---- PDF ber-kop surat: tiap barang = tabel kecil Ukuran | Qty + total; dua kolom; total keseluruhan di bawah ----
async function buatPdf(o: { vendor: string; jenis: Jenis; barang: Barang[] }): Promise<Uint8Array> {
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

  const judul = o.jenis === 'ingatkan' ? 'PENGINGAT ESTIMASI PENGIRIMAN SERAGAM' : o.jenis === 'lanjutan' ? 'TINDAK LANJUT ESTIMASI PENGIRIMAN SERAGAM' : 'PERMINTAAN ESTIMASI PENGIRIMAN SERAGAM';
  page.drawText(judul, { x: PW / 2 - bold.widthOfTextAtSize(judul, 13) / 2, y: Y(y), size: 13, font: bold }); y += 28;
  const total = totalKurang(o.barang);
  for (const [k, v] of [['Tanggal', tglPanjang(hariIni())], ['Kepada', o.vendor], ['Perihal', 'Rekapitulasi kekurangan barang yang belum diterima']]) { page.drawText(k, { x: L, y: Y(y), size: 10.5, font: bold }); page.drawText(': ' + v, { x: L + 52, y: Y(y), size: 10.5, font: reg }); y += 14; }
  y += 8;
  paragraf(o.jenis === 'lanjutan'
    ? `Estimasi pengiriman sebelumnya belum terpenuhi seluruhnya. Berikut sisa barang yang belum kami terima sampai dengan tanggal surat ini, sejumlah ${total} pcs. Mohon estimasi pengiriman yang baru (tanggal dan jumlahnya).`
    : o.jenis === 'ingatkan'
      ? `Menindaklanjuti estimasi pengiriman yang telah disampaikan, berikut sisa barang yang belum kami terima sampai dengan tanggal surat ini, sejumlah ${total} pcs.`
      : `Berikut barang yang telah kami pesan tetapi belum kami terima sampai dengan tanggal surat ini, sejumlah ${total} pcs. Mohon konfirmasi kapan masing-masing dapat dikirim (tanggal dan jumlahnya).`);
  y += 8;

  // blok per barang, ditempatkan di dua kolom (kolom yang lebih pendek lebih dulu)
  const GAP = 14, BW = (W - GAP) / 2, xk = [L, L + BW + GAP], garis = rgb(0, 0, 0), HB = 15;
  const ukur = (b: Barang) => {
    const st = statusBarang(b), judulB = bungkus(namaRapi(b.label), bold, 10.5, BW - 8), ket = bungkus(st.teks, ital, 8.8, BW - 8);
    return { st, judulB, ket, h: judulB.length * 13 + ket.length * 11 + 6 + HB * (b.ukuran.length + 2) + 6 };
  };
  let yk = [y, y], mulai = y;
  const gambarBlok = (b: Barang, m: ReturnType<typeof ukur>, x: number, top: number) => {
    let t = top; for (const s of m.judulB) { page.drawText(s, { x: x + 2, y: Y(t + 10), size: 10.5, font: bold }); t += 13; }
    for (const s of m.ket) { page.drawText(s, { x: x + 2, y: Y(t + 8), size: 8.8, font: ital, color: rgb(...m.st.warna) }); t += 11; }
    t += 4;
    const baris = (a: string, c: string, f: any, fill?: ReturnType<typeof rgb>) => {
      page.drawRectangle({ x, y: Y(t) - HB, width: BW, height: HB, borderColor: garis, borderWidth: 0.5, color: fill });
      page.drawLine({ start: { x: x + BW * 0.62, y: Y(t) }, end: { x: x + BW * 0.62, y: Y(t) - HB }, thickness: 0.5 });
      page.drawText(a, { x: x + 5, y: Y(t) - 11, size: 9.5, font: f });
      page.drawText(c, { x: x + BW - 8 - f.widthOfTextAtSize(c, 9.5), y: Y(t) - 11, size: 9.5, font: f }); t += HB;
    };
    baris('UKURAN', 'QTY', bold, rgb(0.93, 0.93, 0.93));
    for (const u of b.ukuran) baris(u.uk, String(u.kurang), reg);
    baris('Total ' + namaRapi(b.label), String(b.kurang), bold, rgb(0.97, 0.97, 0.97));
  };
  for (const b of o.barang) {
    const m = ukur(b); let k = yk[0] <= yk[1] ? 0 : 1;
    if (yk[k] + m.h > BAWAH) { const lain = 1 - k; if (yk[lain] + m.h <= BAWAH) k = lain; else { baru(); yk = [y, y]; mulai = y; k = 0; } }
    gambarBlok(b, m, xk[k], yk[k]); yk[k] += m.h + 10;
  }
  y = Math.max(yk[0], yk[1]) + 4;
  // total keseluruhan
  if (y + 40 > BAWAH) baru();
  page.drawRectangle({ x: L, y: Y(y) - 24, width: W, height: 24, borderColor: garis, borderWidth: 0.8, color: rgb(0.93, 0.93, 0.93) });
  const ttl = `TOTAL KEKURANGAN: ${total} pcs (${o.barang.length} jenis barang)`;
  page.drawText(ttl, { x: PW / 2 - bold.widthOfTextAtSize(ttl, 11.5) / 2, y: Y(y) - 16.5, size: 11.5, font: bold }); y += 40;
  paragraf('Mohon dipastikan pengiriman sesuai estimasi, atau kabari kami bila ada perubahan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.');
  y += 10;
  if (y + 90 > BAWAH) baru();
  page.drawText('Hormat kami,', { x: L, y: Y(y), size: 10.5, font: reg });
  const ny = y + 62; page.drawText(PENANDATANGAN[0], { x: L, y: Y(ny), size: 10.5, font: bold }); page.drawLine({ start: { x: L, y: Y(ny + 2) }, end: { x: L + bold.widthOfTextAtSize(PENANDATANGAN[0], 10.5), y: Y(ny + 2) }, thickness: 0.6 });
  page.drawText('(' + PENANDATANGAN[1] + ')', { x: L, y: Y(ny + 14), size: 9, font: ital, color: rgb(0.45, 0.45, 0.45) });
  void mulai;
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

  async function ambilBarang(vendorId: number) {
    const [{ data, error }, { data: janji }] = await Promise.all([
      db.rpc('kekurangan_vendor_dasar', { p_vendor: vendorId }),
      db.from('janji_vendor').select('id,grup,label,qty,tgl_dicatat,tgl_janji,catatan,pengingat_oto_untuk,lanjutan_untuk').eq('vendor_id', vendorId).eq('status', 'aktif'),
    ]);
    if (error) throw new Error('Gagal menghitung kekurangan: ' + error.message);
    const barang = susunKekurangan((data ?? []) as Baris[], (janji ?? []) as Janji[]);
    // estimasi yang barangnya sudah lengkap diterima ditutup sebagai terpenuhi
    const ada = new Set(barang.map((b) => b.grup + '|' + b.label)), lengkap = ((janji ?? []) as Janji[]).filter((j) => !ada.has(j.grup + '|' + j.label)).map((j) => j.id);
    if (lengkap.length) await db.from('janji_vendor').update({ status: 'terpenuhi', ditutup_pada: new Date().toISOString() }).in('id', lengkap);
    return barang;
  }
  // buat PDF lalu simpan di Storage publik (folder acak, tidak bisa ditebak); mengembalikan tautan
  async function simpanPdf(vendorId: number, vendor: string, jenis: Jenis, barang: Barang[]) {
    const bytes = await buatPdf({ vendor, jenis, barang });
    const nama = `${jenis === 'tagih' ? 'permintaan-estimasi' : jenis === 'lanjutan' ? 'tindak-lanjut' : 'pengingat'}-seragam-${hariIni()}.pdf`, jalur = `vendor-${vendorId}-${acak().slice(0, 24)}/${nama}`;
    const { error } = await db.storage.from('lampiran-surat').upload(jalur, bytes, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error('Gagal menyimpan PDF: ' + error.message);
    return { url: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/lampiran-surat/${jalur}`, nama };
  }

  // ---------- jalur n8n terjadwal ----------
  if (aksi === 'otomatis_siapkan' || aksi === 'otomatis_tandai') {
    if (!dariN8n) return balas({ error: 'Tidak diizinkan' }, 401);
    if (aksi === 'otomatis_tandai') {
      const t = body?.tandai, ids: number[] = Array.isArray(t?.janji_ids) ? t.janji_ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length || (t?.tipe !== 'pengingat' && t?.tipe !== 'lanjutan')) return balas({ error: 'Data tidak valid' }, 400);
      const { data: rows } = await db.from('janji_vendor').select('id,vendor_id,tgl_janji,jumlah_pengingat,pengingat_oto_untuk,lanjutan_untuk').in('id', ids);
      let baru = 0, vendorId = 0;
      for (const j of rows ?? []) {
        vendorId = j.vendor_id; const kolom = t.tipe === 'pengingat' ? 'pengingat_oto_untuk' : 'lanjutan_untuk';
        if ((j as any)[kolom] === j.tgl_janji) continue;
        baru++; await db.from('janji_vendor').update({ [kolom]: j.tgl_janji, jumlah_pengingat: (j.jumlah_pengingat ?? 0) + 1, terakhir_diingatkan: new Date().toISOString() }).eq('id', j.id);
      }
      if (baru && vendorId) await db.from('tagih_log').insert({ vendor_id: vendorId, jenis: t.tipe === 'pengingat' ? 'ingatkan' : 'lanjutan', cara: 'otomatis', jumlah_barang: ids.length, total_kurang: Number(t.total) || 0, pdf_url: t.pdf_url ?? null });
      return balas({ ok: true });
    }
    const { data: aktif } = await db.from('janji_vendor').select('vendor_id').eq('status', 'aktif');
    const pesan: any[] = [], lewat: any[] = [], hari = hariIni();
    for (const vid of [...new Set((aktif ?? []).map((a: any) => a.vendor_id as number))]) {
      const { data: v } = await db.from('vendor').select('nama,telepon,aktif').eq('id', vid).maybeSingle();
      const nomor = v ? noWa(v.telepon) : '';
      if (!v || !v.aktif || !nomor) { lewat.push({ vendor_id: vid, alasan: 'vendor nonaktif atau nomor telepon kosong' }); continue; }
      let barang: Barang[]; try { barang = await ambilBarang(vid); } catch (e) { lewat.push({ vendor_id: vid, alasan: String((e as Error).message) }); continue; }
      // pengingat sebelum deadline: deadline > 3 hari saat dicatat -> H-2; deadline 2-3 hari -> H-1
      const ing = barang.filter((b) => b.janji && b.status === 'dijanjikan' && (() => { const j = b.janji!, sisa = selisihHari(j.tgl_janji, hari), h = selisihHari(j.tgl_janji, j.tgl_dicatat ?? hari) > 3 ? 2 : 1; return sisa >= 0 && sisa <= h && j.pengingat_oto_untuk !== j.tgl_janji; })());
      // tindak lanjut sekali setelah deadline terlewat dan masih ada kekurangan
      const lan = barang.filter((b) => b.janji && b.status === 'terlambat' && b.janji.lanjutan_untuk !== b.janji.tgl_janji);
      for (const [daftar, jenis, tipe] of [[ing, 'ingatkan', 'pengingat'], [lan, 'lanjutan', 'lanjutan']] as [Barang[], Jenis, string][]) {
        if (!daftar.length) continue;
        try {
          const pdf = await simpanPdf(vid, v.nama, jenis, daftar);
          pesan.push({ jenis: 'vendor', vendor_id: vid, nama: v.nama, nomor, chatId: nomor + '@c.us', teks: susunKeterangan(v.nama, jenis, daftar), pdf_url: pdf.url, pdf_nama: pdf.nama,
            tandai: { tipe, janji_ids: daftar.map((b) => b.janji!.id), total: totalKurang(daftar), pdf_url: pdf.url } });
        } catch (e) { lewat.push({ vendor_id: vid, alasan: String((e as Error).message) }); }
      }
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
  let barang: Barang[];
  try { barang = await ambilBarang(vendorId); } catch (e) { return balas({ error: String((e as Error).message) }, 500); }
  const jenis: Jenis = ['tagih', 'ingatkan', 'lanjutan'].includes(body?.jenis) ? body.jenis : jenisOtomatis(barang);
  const teks = barang.length ? susunKeterangan(v.nama, jenis, barang) : '', nomor = noWa(v.telepon ?? '');
  const ringkas = { total_kurang: totalKurang(barang), jumlah_barang: barang.length, tanpa_estimasi: barang.filter((b) => b.status === 'tanpa').length, terlambat: barang.filter((b) => b.status === 'terlambat').length, tambahan_baru: barang.reduce((a, b) => a + (b.janji ? b.baru : 0), 0) };
  if (aksi === 'pratinjau') {
    let pdf: { url: string; nama: string } | null = null;
    if (barang.length) { try { pdf = await simpanPdf(vendorId, v.nama, jenis, barang); } catch (e) { return balas({ error: String((e as Error).message) }, 500); } }
    return balas({ ok: true, jenis, vendor: { id: v.id, nama: v.nama, ada_nomor: !!nomor, aktif: v.aktif }, ...ringkas, teks, pdf_url: pdf?.url ?? null, pdf_nama: pdf?.nama ?? null });
  }

  if (!v.aktif) return balas({ error: 'Vendor ini nonaktif' }, 422);
  if (!nomor) return balas({ error: 'Nomor WhatsApp vendor belum diisi (Administrator > Vendor)', belum_diatur: true }, 422);
  if (!barang.length) return balas({ error: 'Tidak ada kekurangan yang perlu ditagih' }, 422);
  if (!urlN8n || !tokenN8n) return balas({ error: 'Sambungan n8n belum diatur', belum_diatur: true }, 503);
  let pdf: { url: string; nama: string };
  try { pdf = await simpanPdf(vendorId, v.nama, jenis, barang); } catch (e) { return balas({ error: String((e as Error).message) }, 500); }
  try {
    const r = await fetch(urlN8n, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tokenN8n }, body: JSON.stringify({ pesan: [{ jenis: 'vendor', pic_id: null, nama: v.nama, nomor, chatId: nomor + '@c.us', teks, pdf_url: pdf.url, pdf_nama: pdf.nama }] }) });
    if (!r.ok) return balas({ error: `n8n menolak (HTTP ${r.status})` }, 502);
  } catch (e) { return balas({ error: 'Gagal menghubungi n8n: ' + String(e).slice(0, 160) }, 502); }
  // jejak: catatan pesan dan penghitung pengingat pada estimasi yang ikut disebut
  await db.from('tagih_log').insert({ vendor_id: vendorId, jenis, cara: 'manual', jumlah_barang: barang.length, total_kurang: ringkas.total_kurang, pdf_url: pdf.url });
  for (const b of barang) if (b.janji) await db.from('janji_vendor').update({ terakhir_diingatkan: new Date().toISOString() }).eq('id', b.janji.id);
  return balas({ ok: true, jenis, terkirim: 1, pdf_url: pdf.url });
});
