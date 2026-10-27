// Arsip dokumen seragam ke Google Drive.
// Dipasang sebagai Web App di akun Google pemilik folder. Menerima PDF dari fungsi server `arsip-drive` (Supabase),
// mencari subfolder lokasi di dalam folder utama, lalu menyimpan PDF di sana. Dilindungi token rahasia.
//
// Cara pasang: lihat apps-script/PETUNJUK.md. Isi TOKEN di bawah dengan token yang sama seperti di rahasia Supabase ARSIP_TOKEN.

const FOLDER_UTAMA = '1eM52zz_v9LA8DBt27vk6km-dieWKfDvn';
const TOKEN = 'ISI_TOKEN_DI_SINI';
// Aturan pencocokan lokasi -> folder:
// 1) nama sama persis (huruf besar-kecil dan tanda baca diabaikan) -> pakai folder itu
// 2) selain itu, bandingkan kata-kata penting saja: kata umum, isi dalam kurung, dan tahun diabaikan; harus mirip >= 80% dan
//    hanya satu folder yang terbaik. Jika ragu atau seri, dibuat folder baru supaya dokumen tidak salah masuk folder orang lain.
const KATA_UMUM = ['bpn', 'kab', 'kabupaten', 'kota', 'prov', 'provinsi', 'dan', 'pt', 'cv', 'dinas', 'kantor'];
const AMBANG = 0.8;

function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function kata_(s) {
  return norm_(String(s || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(function (k) { return k && KATA_UMUM.indexOf(k) < 0 && !/^20\d\d$/.test(k); });
}
function skor_(a, b) {
  if (!a.length || !b.length) return 0;
  var sa = {}, sb = {}, i, irisan = 0, gabung = 0;
  a.forEach(function (k) { sa[k] = 1; }); b.forEach(function (k) { sb[k] = 1; });
  for (i in sa) { gabung++; if (sb[i]) irisan++; }
  for (i in sb) { if (!sa[i]) gabung++; }
  return irisan / gabung;
}

// Memakai layanan lanjutan "Drive API" (v3): seluruh nama folder diambil dalam SATU panggilan (~1 detik).
// DriveApp biasa sangat lambat untuk folder berisi ratusan subfolder.
function q_(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function daftarFolder_() {
  var hasil = [], halaman = null;
  do {
    var r = Drive.Files.list({ q: "'" + FOLDER_UTAMA + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
      fields: 'nextPageToken, files(id, name)', pageSize: 1000, pageToken: halaman, supportsAllDrives: true, includeItemsFromAllDrives: true });
    (r.files || []).forEach(function (f) { hasil.push({ id: f.id, nama: f.name, jalur: f.name }); });
    halaman = r.nextPageToken;
  } while (halaman);
  return hasil;
}
function cariFolder_(lokasi) {
  var semua = daftarFolder_(), kl = kata_(lokasi), i;
  for (i = 0; i < semua.length; i++) if (norm_(semua[i].nama) === norm_(lokasi)) return { id: semua[i].id, jalur: semua[i].jalur, baru: false };
  var nilai = semua.map(function (c) { return { x: c, s: skor_(kata_(c.nama), kl) }; }).sort(function (p, q) { return q.s - p.s; });
  if (!nilai.length || nilai[0].s < AMBANG) return null;
  if (nilai[1] && nilai[1].s === nilai[0].s) return null;
  return { id: nilai[0].x.id, jalur: nilai[0].x.jalur, baru: false };
}

function jawab_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

// GET ?token=...&aksi=daftar -> daftar folder yang terlihat, untuk memeriksa pencocokan nama
function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return jawab_({ ok: false, error: 'token salah' });
  if (e.parameter.aksi === 'cocok') {
    var c = cariFolder_(e.parameter.lokasi || '');
    return jawab_({ ok: true, lokasi: e.parameter.lokasi, folder: c ? c.jalur : null });
  }
  return jawab_({ ok: true, folder: daftarFolder_().map(function (x) { return x.jalur; }) });
}

// POST (teks JSON): { token, lokasi, nama, pdf (base64) }
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return jawab_({ ok: false, error: 'token salah' });
    if (d.aksi) return aksiFolder_(d);
    if (!d.lokasi || !d.nama || !d.pdf) return jawab_({ ok: false, error: 'data kurang' });
    var tujuan = cariFolder_(d.lokasi);
    if (!tujuan) {
      var baru = DriveApp.getFolderById(FOLDER_UTAMA).createFolder(String(d.lokasi).toUpperCase());
      tujuan = { id: baru.getId(), jalur: baru.getName(), baru: true };
    }
    var nama = String(d.nama).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
    // file lama dengan nama sama tidak dihapus, hanya diberi tanda "lama" supaya riwayatnya tetap ada
    var stempel = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HHmm');
    var lama = Drive.Files.list({ q: "'" + tujuan.id + "' in parents and trashed = false and name = '" + q_(nama) + "'", fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
    (lama.files || []).forEach(function (f) { Drive.Files.update({ name: nama.replace(/\.pdf$/, '') + ' (lama ' + stempel + ').pdf' }, f.id, null, { supportsAllDrives: true }); });
    var file = DriveApp.getFolderById(tujuan.id).createFile(Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', nama));
    return jawab_({ ok: true, folder: tujuan.jalur, folderBaru: tujuan.baru, nama: nama, url: file.getUrl() });
  } catch (err) { return jawab_({ ok: false, error: String(err) }); }
}

// ---- Akses terbatas ke isi folder utama (untuk Claude Code / admin): daftar isi, baca berkas, unggah berkas ----
// Semua aksi hanya berlaku DI DALAM folder utama dan turunannya. Tidak ada aksi memindah atau menimpa berkas; satu-satunya penghapusan adalah buangForm (hanya Google Form, ke Sampah).
// POST JSON: { token, aksi: 'pohon' | 'baca' | 'unggah', ... }
//   pohon : { id? (folder, default folder utama), kedalaman? (1-4, default 1) } -> isi folder (folder dan berkas)
//   baca  : { id (berkas) } -> teks (Doc/Sheet/teks biasa) atau base64 (berkas lain, maksimal 8 MB)
//   unggah: { id? (folder tujuan, default folder utama), nama, isi (base64), mime? } -> membuat berkas baru; nama sama tidak ditimpa (yang lama diberi tanda lama)
var BATAS_BACA = 8 * 1024 * 1024;

function dalamPohon_(id) {
  var cur = id;
  for (var i = 0; i < 12 && cur; i++) {
    if (cur === FOLDER_UTAMA) return true;
    var f = Drive.Files.get(cur, { fields: 'parents', supportsAllDrives: true });
    cur = f.parents && f.parents[0];
  }
  return false;
}
function isiFolder_(id, kedalaman, jalur) {
  var hasil = [], halaman = null;
  do {
    var r = Drive.Files.list({ q: "'" + id + "' in parents and trashed = false", orderBy: 'folder,name',
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)', pageSize: 1000, pageToken: halaman, supportsAllDrives: true, includeItemsFromAllDrives: true });
    (r.files || []).forEach(function (f) {
      var folder = f.mimeType === 'application/vnd.google-apps.folder', o = { id: f.id, nama: f.name, jenis: folder ? 'folder' : f.mimeType, ukuran: f.size ? Number(f.size) : null, diubah: f.modifiedTime };
      if (folder && kedalaman > 1) o.isi = isiFolder_(f.id, kedalaman - 1);
      hasil.push(o);
    });
    halaman = r.nextPageToken;
  } while (halaman);
  return hasil;
}
function aksiFolder_(d) {
  var aksi = String(d.aksi);
  if (aksi === 'pohon') {
    var id = d.id || FOLDER_UTAMA;
    if (!dalamPohon_(id)) return jawab_({ ok: false, error: 'di luar folder utama' });
    return jawab_({ ok: true, id: id, isi: isiFolder_(id, Math.min(4, Math.max(1, Number(d.kedalaman) || 1))) });
  }
  if (aksi === 'baca') {
    if (!d.id || !dalamPohon_(d.id)) return jawab_({ ok: false, error: 'di luar folder utama' });
    var m = Drive.Files.get(d.id, { fields: 'id, name, mimeType, size', supportsAllDrives: true }), blob;
    if (m.mimeType === 'application/vnd.google-apps.spreadsheet') blob = Utilities.newBlob(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + d.id + '/export?mimeType=text/csv', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getContent(), 'text/csv', m.name + '.csv');
    else if (m.mimeType === 'application/vnd.google-apps.document') blob = Utilities.newBlob(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + d.id + '/export?mimeType=text/plain', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getContent(), 'text/plain', m.name + '.txt');
    else { if (Number(m.size) > BATAS_BACA) return jawab_({ ok: false, error: 'berkas lebih dari 8 MB' }); blob = DriveApp.getFileById(d.id).getBlob(); }
    var bytes = blob.getBytes(); if (bytes.length > BATAS_BACA) return jawab_({ ok: false, error: 'hasil lebih dari 8 MB' });
    var tipe = blob.getContentType() || '', teks = /^text\/|json|csv|xml/.test(tipe);
    return jawab_({ ok: true, nama: m.name, mime: m.mimeType, teks: teks ? blob.getDataAsString('UTF-8') : null, base64: teks ? null : Utilities.base64Encode(bytes) });
  }
  if (aksi === 'unggah') {
    var tujuan = d.id || FOLDER_UTAMA;
    if (!dalamPohon_(tujuan)) return jawab_({ ok: false, error: 'di luar folder utama' });
    if (!d.nama || !d.isi) return jawab_({ ok: false, error: 'data kurang' });
    var nama = String(d.nama).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    var stempel = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HHmm');
    var lama = Drive.Files.list({ q: "'" + tujuan + "' in parents and trashed = false and name = '" + q_(nama) + "'", fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
    (lama.files || []).forEach(function (f) { Drive.Files.update({ name: nama.replace(/(\.[^.]+)?$/, ' (lama ' + stempel + ')$1') }, f.id, null, { supportsAllDrives: true }); });
    var file = DriveApp.getFolderById(tujuan).createFile(Utilities.newBlob(Utilities.base64Decode(d.isi), d.mime || 'application/octet-stream', nama));
    return jawab_({ ok: true, id: file.getId(), nama: nama, url: file.getUrl() });
  }
  if (aksi === 'buatForm') return jawab_(buatFormLokasi_(d));
  if (aksi === 'setDeskripsi') { // uji format deskripsi pada form di dalam folder utama
    if (!d.id || !dalamPohon_(d.id)) return jawab_({ ok: false, error: 'di luar folder utama' });
    var fm = Drive.Files.get(d.id, { fields: 'mimeType', supportsAllDrives: true });
    if (fm.mimeType !== 'application/vnd.google-apps.form') return jawab_({ ok: false, error: 'bukan Google Form' });
    FormApp.openById(d.id).setDescription(String(d.teks));
    return jawab_({ ok: true });
  }
  if (aksi === 'buangForm') {
    // satu-satunya aksi yang menghapus, dan sangat dibatasi: hanya Google Form, hanya di dalam folder utama, hanya ke Sampah (bisa dipulihkan 30 hari),
    // dan hanya untuk id yang disebut satu per satu serta kata konfirmasi. Tidak ada penghapusan permanen.
    if (d.konfirmasi !== 'HAPUS FORM' || !(d.ids && d.ids.length)) return jawab_({ ok: false, error: 'butuh konfirmasi "HAPUS FORM" dan daftar ids' });
    var hasil = d.ids.slice(0, 100).map(function (id) {
      try {
        if (!dalamPohon_(id)) return { id: id, ok: false, error: 'di luar folder utama' };
        var m = Drive.Files.get(id, { fields: 'id, name, mimeType', supportsAllDrives: true });
        if (m.mimeType !== 'application/vnd.google-apps.form') return { id: id, ok: false, error: 'bukan Google Form' };
        Drive.Files.update({ trashed: true }, id, null, { supportsAllDrives: true });
        return { id: id, ok: true, nama: m.name };
      } catch (err) { return { id: id, ok: false, error: String(err) }; }
    });
    return jawab_({ ok: true, hasil: hasil });
  }
  if (aksi === 'gambarForm') return jawab_(gambarForm_(d));
  return jawab_({ ok: false, error: 'aksi tidak dikenal' });
}

// ---- Mengganti gambar yang SUDAH terpasang di form-form lokasi (tanpa membuat ulang form) ----
// POST: { token, aksi: 'gambarForm', mode: 'lihat' | 'uji' | 'ganti', ids?: [formId], mulai?: 0, jumlah?: 25,
//         gambar?: { caraBaju, tabelBaju, caraCelana, tabelCelana } (ID berkas PNG di dalam folder utama; bila kosong dicari otomatis berdasarkan NAMA_GAMBAR) }
//  lihat : daftar item bergambar tiap form (judul + jenis yang terbaca), untuk memeriksa sebelum mengganti. Tanpa ids = form pertama di registri.
//  uji   : sama seperti ganti tetapi TIDAK mengubah apa pun, hanya melaporkan gambar mana yang akan diganti.
//  ganti : setImage() pada ImageItem yang terbaca jenisnya (cara/tabel x baju/celana; lihat jenisGambar_), lebar 640, teks alternatif diisi. Urutan, jawaban, dan pengaturan form tidak berubah.
// Tanpa ids dipakai semua form di registri, bertahap lewat mulai/jumlah; respons memuat "berikut" (nilai mulai berikutnya, null bila selesai).
// Hanya ImageItem yang terbaca jenisnya yang disentuh (gambar sepatu dan lainnya dilewati). Tidak ada penghapusan.
var ALT_GAMBAR = { caraBaju: 'Cara mengukur baju', tabelBaju: 'Tabel ukuran baju', caraCelana: 'Cara mengukur celana', tabelCelana: 'Tabel ukuran celana' };
function kainDari_(teks) {
  var t = String(teks || '').toLowerCase(), b = /baju/.test(t), c = /celana/.test(t);
  return b === c ? null : (b ? 'Baju' : 'Celana');
}
function ukuranPng_(blob) {  // lebar x tinggi dari kepala berkas PNG; null bila bukan PNG
  var b = blob.getBytes();
  if (b.length < 24 || (b[1] & 255) !== 80 || (b[2] & 255) !== 78) return null;
  function u32(o) { return (b[o] & 255) * 16777216 + ((b[o + 1] & 255) << 16) + ((b[o + 2] & 255) << 8) + (b[o + 3] & 255); }
  return { w: u32(16), h: u32(20) };
}
// Menentukan gambar mana ini. Urutan: (1) judul atau teks alternatif ("cara"/"tabel" + "baju"/"celana"), (2) kain dari judul section di atasnya,
// (3) bila tak ada petunjuk jenis, bentuk gambar lama: tegak = cara mengukur, mendatar = tabel. Gambar yang sudah diganti diberi teks alternatif (ALT_GAMBAR),
// sehingga dikenali lewat langkah (1) dan aman bila dijalankan ulang.
function jenisGambar_(ii, header, terakhir) {
  var alt = ''; try { alt = ii.getAltText() || ''; } catch (e) { alt = ''; }
  var teks = ii.getTitle() + ' ' + alt, t = teks.toLowerCase();
  var kain = kainDari_(teks) || kainDari_(header) || kainDari_(terakhir), jenis = null, dasar = 'judul';
  if (/cara|ukur(?!an)/.test(t)) jenis = 'cara'; else if (/tabel|ukuran/.test(t)) jenis = 'tabel';
  else {
    var dim = ukuranPng_(ii.getImage());
    if (dim) { jenis = dim.h > dim.w ? 'cara' : 'tabel'; dasar = 'bentuk ' + dim.w + 'x' + dim.h; } else dasar = 'bukan PNG';
  }
  return { kunci: (jenis && kain) ? jenis + kain : null, dasar: dasar + (kain ? '' : ', kain tak terbaca') };
}
function gambarForm_(d) {
  var mode = String(d.mode || 'lihat'), mulai = Number(d.mulai) || 0, jumlah = Math.min(Number(d.jumlah) || 25, 50), t0 = Date.now();
  var ids = d.ids && d.ids.length ? d.ids : null, berikut = null;
  if (!ids) {
    var baris = registri_().getDataRange().getValues().slice(1).filter(function (r) { return r[1]; });
    var semua = baris.map(function (r) { return String(r[1]); });
    if (mode === 'lihat' && !d.mulai) semua = semua.slice(0, 1);
    ids = semua.slice(mulai, mulai + jumlah);
    berikut = mulai + jumlah < semua.length && mode !== 'lihat' ? mulai + jumlah : null;
  } else ids = ids.slice(0, jumlah);
  var blob = {};
  if (mode !== 'lihat') {
    var kunci = ['caraBaju', 'tabelBaju', 'caraCelana', 'tabelCelana'];
    var sumber = d.gambar || cariGambarUkuran_();
    if (sumber.error) return { ok: false, error: sumber.error };
    for (var k = 0; k < kunci.length; k++) {
      var fid = sumber[kunci[k]];
      if (!fid || !dalamPohon_(fid)) return { ok: false, error: 'gambar.' + kunci[k] + ' kosong atau di luar folder utama' };
      var fl = DriveApp.getFileById(fid);
      if (String(fl.getMimeType()).indexOf('image/') !== 0) return { ok: false, error: 'gambar.' + kunci[k] + ' bukan gambar' };
      blob[kunci[k]] = fl.getBlob();
    }
  }
  var hasil = [];
  for (var i = 0; i < ids.length; i++) {
    if (Date.now() - t0 > 5 * 60 * 1000) { berikut = berikut === null ? null : mulai + i; hasil.push({ id: ids[i], ok: false, error: 'waktu habis, ulangi dari mulai=' + (mulai + i) }); break; }
    var id = ids[i];
    try {
      if (!dalamPohon_(id)) { hasil.push({ id: id, ok: false, error: 'di luar folder utama' }); continue; }
      var m = Drive.Files.get(id, { fields: 'mimeType', supportsAllDrives: true });
      if (m.mimeType !== 'application/vnd.google-apps.form') { hasil.push({ id: id, ok: false, error: 'bukan Google Form' }); continue; }
      var form = FormApp.openById(id), r = { id: id, nama: form.getTitle(), ok: true, gambar: [] }, header = '', terakhir = '';
      form.getItems().forEach(function (it) {
        var tp = it.getType();
        if (tp === FormApp.ItemType.IMAGE) {
          var ii = it.asImageItem(), j = jenisGambar_(ii, header, terakhir);
          var ada = { posisi: it.getIndex(), judul: it.getTitle(), konteks: header + ' | ' + terakhir, jenis: j.kunci, dasar: j.dasar };
          if (j.kunci && mode === 'ganti') { ii.setImage(blob[j.kunci]).setWidth(640).setAltText(ALT_GAMBAR[j.kunci]); ada.diganti = true; }
          r.gambar.push(ada);
        } else {
          terakhir = it.getTitle();
          if (tp === FormApp.ItemType.PAGE_BREAK || tp === FormApp.ItemType.SECTION_HEADER) header = it.getTitle();
        }
      });
      hasil.push(r);
    } catch (err) { hasil.push({ id: id, ok: false, error: String(err) }); }
  }
  return { ok: true, mode: mode, jumlah: hasil.length, berikut: berikut, hasil: hasil };
}

// Gambar dicari berdasarkan nama berkas (yang terbaru, di dalam folder utama) bila ID tidak diberikan.
var NAMA_GAMBAR = {
  caraBaju: 'Form - Cara Mengukur Baju (besar).png', tabelBaju: 'Form - Tabel Ukuran Baju (besar).png',
  caraCelana: 'Form - Cara Mengukur Celana (besar).png', tabelCelana: 'Form - Tabel Ukuran Celana (besar).png'
};
function cariGambarUkuran_() {
  var out = {};
  for (var k in NAMA_GAMBAR) {
    var r = Drive.Files.list({ q: "name = '" + q_(NAMA_GAMBAR[k]) + "' and trashed = false", orderBy: 'modifiedTime desc', fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
    var f = (r.files || []).filter(function (x) { return dalamPohon_(x.id); })[0];
    if (!f) return { error: 'gambar "' + NAMA_GAMBAR[k] + '" tidak ditemukan di dalam folder utama' };
    out[k] = f.id;
  }
  return out;
}

// Dijalankan dari editor (tombol Run), hasilnya di Log eksekusi. Tidak butuh token.
//  lihatGambarForm : tampilkan item bergambar di SATU form (untuk memeriksa judul)
//  ujiGambarForm   : laporan semua form tanpa mengubah apa pun
//  gantiGambarForm : ganti gambar di semua form; bila waktu habis, jalankan lagi (lanjut dari form terakhir)
function lihatGambarForm() { Logger.log(JSON.stringify(gambarForm_({ mode: 'lihat' }), null, 1)); }
function ujiGambarForm() { jalankanGambar_('uji'); }
function gantiGambarForm() { jalankanGambar_('ganti'); }
function ulangiDariAwalGambar() { var p = PropertiesService.getScriptProperties(); p.deleteProperty('GAMBAR_MULAI_uji'); p.deleteProperty('GAMBAR_MULAI_ganti'); }
function jalankanGambar_(mode) {
  var props = PropertiesService.getScriptProperties(), kunci = 'GAMBAR_MULAI_' + mode, t0 = Date.now();
  var mulai = Number(props.getProperty(kunci)) || 0, jml = { form: 0, gambar: 0, diganti: 0, perJenis: {}, gagal: [], tanpaJenis: {} };
  while (Date.now() - t0 < 4 * 60 * 1000) {
    var h = gambarForm_({ mode: mode, mulai: mulai, jumlah: 10 });
    if (!h.ok) { Logger.log('GAGAL: ' + JSON.stringify(h)); return; }
    h.hasil.forEach(function (r) {
      jml.form++;
      if (!r.ok) { jml.gagal.push(r.id + ': ' + r.error); return; }
      r.gambar.forEach(function (g) { jml.gambar++; if (g.diganti) jml.diganti++; if (g.jenis) jml.perJenis[g.jenis] = (jml.perJenis[g.jenis] || 0) + 1; else { var kk = (g.judul || '(tanpa judul)') + ' @ ' + g.konteks + ' [' + g.dasar + ']'; jml.tanpaJenis[kk] = (jml.tanpaJenis[kk] || 0) + 1; } });
    });
    if (h.berikut === null) { props.deleteProperty(kunci); Logger.log('SELESAI (' + mode + '): ' + JSON.stringify(jml, null, 1)); return; }
    mulai = h.berikut; props.setProperty(kunci, String(mulai));
  }
  Logger.log('BELUM SELESAI (' + mode + '), jalankan lagi untuk lanjut dari form ke-' + mulai + '. Sejauh ini: ' + JSON.stringify(jml, null, 1));
}

// Membuat SATU form contoh (terpisah dari form lokasi, disimpan di folder utama) berisi 4 gambar baru dengan lebar tampil yang sama, untuk dilihat dulu.
// Jalankan dari editor; tautan form muncul di Log eksekusi. Form contoh boleh dihapus kapan saja.
function buatContohFormGambar() {
  var g = cariGambarUkuran_();
  if (g.error) { Logger.log('GAGAL: ' + g.error); return; }
  var form = FormApp.create('CONTOH - Gambar petunjuk ukuran (boleh dihapus)');
  form.setDescription('Contoh tampilan gambar petunjuk ukuran. Form ini hanya untuk dilihat dan boleh dihapus.');
  [['UKURAN BAJU', 'caraBaju', 'tabelBaju', 'baju'], ['UKURAN CELANA', 'caraCelana', 'tabelCelana', 'celana']].forEach(function (b) {
    form.addSectionHeaderItem().setTitle(b[0]);
    [b[1], b[2]].forEach(function (k) {
      form.addImageItem().setImage(DriveApp.getFileById(g[k]).getBlob()).setWidth(640).setAltText(ALT_GAMBAR[k]);
    });
    form.addTextItem().setTitle('Contoh isian ukuran ' + b[3]);
  });
  DriveApp.getFileById(form.getId()).moveTo(DriveApp.getFolderById(FOLDER_UTAMA));
  Logger.log('Tautan isi (untuk dilihat): ' + form.getPublishedUrl());
  Logger.log('Tautan edit: ' + form.getEditUrl());
}

// ---- Membuat Google Form pendataan ukuran dari form template, di dalam folder lokasinya ----
// POST: { token, aksi: 'buatForm', lokasi, folderId, judul?, bagian?: [..], templateId? } -> membuat SATU form (dilewati bila sudah ada form bernama sama di folder itu).
// Form: wajib login Google + email terverifikasi, batas 1 tanggapan per akun, tidak bisa diedit sendiri; LOKASI pilihan tunggal;
// BAGIAN KERJA dibatasi pada `bagian` bila diberikan; NAMA LENGKAP wajib huruf. Tanggapan masuk ke spreadsheet data (tab baru).
var NAMA_TEMPLATE = 'Template Form Pengisian Data Seragam Karyawan';
var SPREADSHEET_DATA_ID = '1UMLvjFVYAJrsQh_6k8WU0B1c03lJQdstkJsV4GmCVSE';
var DESKRIPSI_FORM = [
  'MOHON DIBACA DAN DICERMATI DENGAN TELITI!',
  '',
  'Formulir ini digunakan untuk pendataan ukuran seragam dan sepatu karyawan di lokasi {LOKASI} untuk tahun 2027. Tujuan pendataan ini adalah mengumpulkan data ukuran yang pasti sejak awal, supaya saat tahun 2027 berjalan, pemesanan dan pengiriman seragam bisa dilakukan secepat mungkin. Mohon perhatikan hal berikut:',
  '',
  '1. Tulis nama lengkap sesuai KTP.',
  '2. Lihat tabel ukuran terlebih dahulu, lalu pilih ukuran sesuai ukuran badan Anda yang sebenarnya.',
  '3. Ukuran yang Anda kirim dianggap FINAL dan menjadi dasar pemesanan. Mohon isi dengan teliti dan jangan asal memilih.',
  '4. Formulir ini hanya bisa diisi SATU KALI per akun Google. Jika terjadi kesalahan pengisian atau ada perubahan data, segera hubungi admin, jangan mengisi ulang.',
  '5. Pengisian formulir ini bukan jaminan pemberian seragam. Jenis dan jumlah seragam (baju, celana, sepatu, dan jumlah stel) menyesuaikan ketentuan kontrak dan anggaran masing-masing lokasi, sehingga bisa berbeda antar lokasi.',
  '',
  'Terima kasih atas kerja samanya.'
].join('\n');

// Registri spreadsheet tanggapan (satu baris per form): dibaca sinkronisasi Supabase untuk mengambil jawaban dari folder masing-masing.
function registri_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('REGISTRI_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('REGISTRI TANGGAPAN FORM');
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(FOLDER_UTAMA));
    props.setProperty('REGISTRI_ID', ss.getId());
    var s0 = ss.getSheets()[0]; s0.setName('Registri');
    s0.appendRow(['Lokasi', 'ID form', 'ID spreadsheet tanggapan', 'ID folder', 'Dibuat']); s0.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

function idTemplate_(d) {
  if (d && d.templateId) return d.templateId;
  var tersimpan = PropertiesService.getScriptProperties().getProperty('TEMPLATE_ID');
  if (tersimpan) return tersimpan;
  var it = DriveApp.getFilesByName(NAMA_TEMPLATE);
  while (it.hasNext()) { var f = it.next(); if (f.getMimeType() === 'application/vnd.google-apps.form' && !f.isTrashed()) { PropertiesService.getScriptProperties().setProperty('TEMPLATE_ID', f.getId()); return f.getId(); } }
  throw new Error('Form template "' + NAMA_TEMPLATE + '" tidak ditemukan di Drive akun ini');
}
function buatFormLokasi_(d) {
  var salinan = null, ssTanggapan = null;
  try {
    if (!d.lokasi || !d.folderId) return { ok: false, error: 'lokasi dan folderId wajib' };
    if (!dalamPohon_(d.folderId)) return { ok: false, error: 'di luar folder utama' };
    var judul = String(d.judul || ('DATA SERAGAM ' + d.lokasi)).replace(/\s+/g, ' ').trim();
    var ada = Drive.Files.list({ q: "'" + d.folderId + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.form' and name = '" + q_(judul) + "'", fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
    if (ada.files && ada.files.length) return { ok: true, dilewati: true, id: ada.files[0].id };
    salinan = DriveApp.getFileById(idTemplate_(d)).makeCopy(judul, DriveApp.getFolderById(d.folderId));
    var form = FormApp.openById(salinan.getId());
    try { form.setPublished(true); } catch (e0) { /* versi lama tanpa status terbit */ }
    form.setTitle('Form Pengisian Data Seragam Karyawan - ' + d.lokasi);
    if (d.deskripsi === '') { // pakai deskripsi bawaan template apa adanya (mempertahankan format tebal/miring buatan editor Forms)
      if (form.getDescription().indexOf('{LOKASI}') >= 0) throw new Error('deskripsi template masih berisi {LOKASI}; hapus dari template atau kirim parameter deskripsi');
    } else form.setDescription(String(d.deskripsi || DESKRIPSI_FORM).split('{LOKASI}').join(d.lokasi));
    if (FormApp.EmailCollectionType) form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); else form.setCollectEmail(true);
    form.setLimitOneResponsePerUser(true);
    form.setAllowResponseEdits(false);
    form.setShowLinkToRespondAgain(false);
    form.setConfirmationMessage('Terima kasih, data ukuran Anda sudah tercatat. Jika ada kesalahan atau perubahan, hubungi admin.');
    form.setAcceptingResponses(true);
    var items = form.getItems(), pilihan = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], jd = String(it.getTitle()).trim().toUpperCase(), tp = it.getType();
      if (jd === 'LOKASI' && tp === FormApp.ItemType.TEXT) {
        var idx = it.getIndex(); form.deleteItem(idx);
        pilihan = form.addListItem().setTitle('LOKASI').setHelpText('Lokasi sudah ditentukan untuk formulir ini.').setChoiceValues([d.lokasi]).setRequired(true);
        form.moveItem(pilihan.getIndex(), idx);
      } else if (jd === 'LOKASI' && tp === FormApp.ItemType.LIST) { // template sudah berupa pilihan tunggal: cukup ganti pilihannya
        pilihan = it.asListItem().setChoiceValues([d.lokasi]).setRequired(true);
      } else if (jd === 'BAGIAN KERJA' && tp === FormApp.ItemType.MULTIPLE_CHOICE && d.bagian && d.bagian.length) {
        it.asMultipleChoiceItem().setChoiceValues(d.bagian);
      } else if (jd === 'UKURAN SEPATU' && (tp === FormApp.ItemType.PAGE_BREAK || tp === FormApp.ItemType.SECTION_HEADER) && d.gambarSepatuId) {
        var gbr = form.addImageItem().setImage(DriveApp.getFileById(d.gambarSepatuId).getBlob()).setTitle('Tabel ukuran sepatu').setWidth(640);
        form.moveItem(gbr.getIndex(), it.getIndex() + 1);
      } else if (jd === 'NAMA LENGKAP' && tp === FormApp.ItemType.TEXT) {
        var cek = FormApp.createTextValidation().setHelpText('Tulis nama lengkap sesuai KTP, hanya huruf (minimal 3 karakter).').requireTextMatchesPattern("^[A-Za-z][A-Za-z .,'-]{2,}$").build();
        it.asTextItem().setHelpText('Sesuai KTP, tanpa singkatan atau nama panggilan.').setValidation(cek).setRequired(true);
      }
    }
    // spreadsheet tanggapan khusus form ini, disimpan di folder lokasinya, lalu didaftarkan di registri untuk sinkronisasi
    ssTanggapan = SpreadsheetApp.create('TANGGAPAN ' + d.lokasi);
    DriveApp.getFileById(ssTanggapan.getId()).moveTo(DriveApp.getFolderById(d.folderId));
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ssTanggapan.getId());
    var reg = registri_();
    reg.appendRow([d.lokasi, form.getId(), ssTanggapan.getId(), d.folderId, new Date()]);
    var isi = pilihan ? form.createResponse().withItemResponse(pilihan.createResponse(d.lokasi)).toPrefilledUrl() : form.getPublishedUrl();
    return { ok: true, id: form.getId(), isi: isi, edit: form.getEditUrl(), nama: judul, tanggapanId: ssTanggapan.getId(), registriId: reg.getParent().getId() };
  } catch (err) {
    try { if (salinan) salinan.setTrashed(true); } catch (e1) { /* biarkan */ }
    try { if (ssTanggapan) DriveApp.getFileById(ssTanggapan.getId()).setTrashed(true); } catch (e2) { /* biarkan */ }  // salinan setengah jadi dibuang supaya bisa diulang
    return { ok: false, error: String(err) };
  }
}

// Jalankan SEKALI dari editor (tombol Run) untuk memberi izin akses Drive. Pastikan layanan "Drive API" sudah ditambahkan (Layanan > +).
function izinkan() {
  Logger.log('Folder utama: ' + DriveApp.getFolderById(FOLDER_UTAMA).getName());
  Logger.log('Subfolder: ' + daftarFolder_().map(function (x) { return x.jalur; }).join(' | '));
}
