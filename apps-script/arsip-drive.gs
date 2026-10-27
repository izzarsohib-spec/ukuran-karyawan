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
  return jawab_({ ok: false, error: 'aksi tidak dikenal' });
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

function idTemplate_(d) {
  if (d && d.templateId) return d.templateId;
  var tersimpan = PropertiesService.getScriptProperties().getProperty('TEMPLATE_ID');
  if (tersimpan) return tersimpan;
  var it = DriveApp.getFilesByName(NAMA_TEMPLATE);
  while (it.hasNext()) { var f = it.next(); if (f.getMimeType() === 'application/vnd.google-apps.form' && !f.isTrashed()) { PropertiesService.getScriptProperties().setProperty('TEMPLATE_ID', f.getId()); return f.getId(); } }
  throw new Error('Form template "' + NAMA_TEMPLATE + '" tidak ditemukan di Drive akun ini');
}
function buatFormLokasi_(d) {
  var salinan = null;
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
    form.setDescription(String(d.deskripsi || DESKRIPSI_FORM).split('{LOKASI}').join(d.lokasi));
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
    form.setDestination(FormApp.DestinationType.SPREADSHEET, SPREADSHEET_DATA_ID);
    var isi = pilihan ? form.createResponse().withItemResponse(pilihan.createResponse(d.lokasi)).toPrefilledUrl() : form.getPublishedUrl();
    return { ok: true, id: form.getId(), isi: isi, edit: form.getEditUrl(), nama: judul };
  } catch (err) {
    try { if (salinan) salinan.setTrashed(true); } catch (e1) { /* biarkan */ }  // salinan setengah jadi dibuang supaya bisa diulang
    return { ok: false, error: String(err) };
  }
}

// Jalankan SEKALI dari editor (tombol Run) untuk memberi izin akses Drive. Pastikan layanan "Drive API" sudah ditambahkan (Layanan > +).
function izinkan() {
  Logger.log('Folder utama: ' + DriveApp.getFolderById(FOLDER_UTAMA).getName());
  Logger.log('Subfolder: ' + daftarFolder_().map(function (x) { return x.jalur; }).join(' | '));
}
