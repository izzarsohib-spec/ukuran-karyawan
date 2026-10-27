// Membuat Google Form pendataan ukuran seragam PER LOKASI dari satu form template, dengan pencegahan data ganda.
// Dijalankan oleh pemilik template (akun Google yang memiliki form dan spreadsheet data). Tidak memuat rahasia: anon key Supabase memang publik.
//
// Yang dilakukan untuk tiap lokasi:
//  - menyalin form template, judul dan {LOKASI} di deskripsi diganti nama lokasi
//  - pertanyaan LOKASI diganti pilihan tunggal (tidak bisa salah ketik), pilihan BAGIAN KERJA dibatasi pada bagian yang ada di anggaran lokasi itu
//  - NAMA LENGKAP wajib huruf (tanpa angka/simbol aneh) minimal 3 karakter
//  - wajib login Google + email terverifikasi, BATAS 1 TANGGAPAN per akun, tanggapan tidak bisa diedit sendiri (koreksi lewat admin)
//  - tanggapan masuk ke spreadsheet data (tab baru), jadi sinkronisasi Code.gs tetap jalan tanpa diubah
//  - tautan isi (lokasi sudah terpilih) dan tautan edit dicatat di spreadsheet "LINK FORM SERAGAM 2027"
//
// Cara pakai: tempel di proyek Apps Script, isi TEMPLATE_ID bila perlu, jalankan buatContoh() dulu (satu form), periksa hasilnya,
// lalu jalankan buatSemua() (aman diulang: lokasi yang sudah punya form dilewati; berhenti sendiri sebelum batas 6 menit).

var NAMA_TEMPLATE = 'Template Form Pengisian Data Seragam Karyawan';
var TEMPLATE_ID = '';                                   // kosongkan untuk mencari berdasarkan nama di Drive; atau isi ID dari tautan edit (.../forms/d/ID/edit)
var SPREADSHEET_DATA_ID = '1UMLvjFVYAJrsQh_6k8WU0B1c03lJQdstkJsV4GmCVSE'; // tujuan tanggapan (sama dengan Code.gs)
var FOLDER_ID = '';                                     // opsional: folder Drive tempat form hasil salinan disimpan
var SUPABASE_URL = 'https://vqcusagijiavaoljfrib.supabase.co';
var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxY3VzYWdpamlhdmFvbGpmcmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIzOTksImV4cCI6MjEwODA2ODM5OX0.VeslVR4UHv26LCMbkO7KP0k96r8lg7-NNLjY30iMyFk';
var BATAS_MS = 5 * 60 * 1000;

var DESKRIPSI = 'MOHON DIBACA DAN DICERMATI DENGAN TELITI!\n\n' +
  'Formulir ini digunakan untuk pendataan ukuran seragam dan sepatu karyawan di lokasi {LOKASI} untuk tahun 2027. ' +
  'Tujuan pendataan ini adalah mengumpulkan data ukuran yang pasti sejak awal, supaya saat tahun 2027 berjalan, pemesanan dan pengiriman seragam bisa dilakukan secepat mungkin. Mohon perhatikan hal berikut:\n\n' +
  '1. Tulis nama lengkap sesuai KTP.\n' +
  '2. Lihat tabel ukuran terlebih dahulu, lalu pilih ukuran sesuai ukuran badan Anda yang sebenarnya.\n' +
  '3. Ukuran yang Anda kirim dianggap FINAL dan menjadi dasar pemesanan. Mohon isi dengan teliti dan jangan asal memilih.\n' +
  '4. Formulir ini hanya bisa diisi SATU KALI per akun Google. Jika terjadi kesalahan pengisian atau ada perubahan data, segera hubungi admin, jangan mengisi ulang.\n' +
  '5. Pengisian formulir ini bukan jaminan pemberian seragam. Jenis dan jumlah seragam (baju, celana, sepatu, dan jumlah stel) menyesuaikan ketentuan kontrak dan anggaran masing-masing lokasi, sehingga bisa berbeda antar lokasi.\n\n' +
  'Terima kasih atas kerja samanya.';

// ---------- titik masuk ----------
function buatContoh() { prosesLokasi_(1); }
function buatSemua() { prosesLokasi_(0); }

// ---------- inti ----------
function prosesLokasi_(maks) {
  var mulai = Date.now();
  var daftar = ambilLokasi_();
  var lembar = lembarLink_();
  var sudah = {};
  var v = lembar.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) sudah[String(v[i][0])] = true;

  var template = DriveApp.getFileById(idTemplate_());
  var dibuat = 0, lewat = 0;
  var namaLokasi = Object.keys(daftar).sort();
  for (var k = 0; k < namaLokasi.length; k++) {
    var lok = namaLokasi[k];
    if (sudah[lok]) { lewat++; continue; }
    if (maks && dibuat >= maks) break;
    if (Date.now() - mulai > BATAS_MS) { Logger.log('Waktu hampir habis. Jalankan buatSemua() lagi untuk melanjutkan.'); break; }
    var hasil = buatFormLokasi_(template, lok, daftar[lok]);
    lembar.appendRow([lok, daftar[lok].bagian.join(', '), hasil.isi, hasil.edit, hasil.id, new Date()]);
    SpreadsheetApp.flush();
    dibuat++;
  }
  Logger.log('Selesai: ' + dibuat + ' form baru, ' + lewat + ' dilewati (sudah ada), total lokasi ' + namaLokasi.length + '. Daftar tautan: ' + lembar.getParent().getUrl());
}

function buatFormLokasi_(template, lokasi, info) {
  var salinan = template.makeCopy('Form Ukuran Seragam - ' + lokasi);
  if (FOLDER_ID) { DriveApp.getFolderById(FOLDER_ID).addFile(salinan); DriveApp.getRootFolder().removeFile(salinan); }
  var form = FormApp.openById(salinan.getId());

  form.setTitle('Form Pengisian Data Seragam Karyawan - ' + lokasi);
  form.setDescription(DESKRIPSI.replace(/\{LOKASI\}/g, lokasi));

  // pembatasan: login Google, 1 tanggapan per akun, tidak bisa diedit sendiri
  if (FormApp.EmailCollectionType) form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); else form.setCollectEmail(true);
  form.setLimitOneResponsePerUser(true);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage('Terima kasih, data ukuran Anda sudah tercatat. Jika ada kesalahan atau perubahan, hubungi admin.');
  form.setAcceptingResponses(true);

  var items = form.getItems(), lokItem = null, pilihanLokasi = null;
  for (var i = 0; i < items.length; i++) {
    var it = items[i], judul = String(it.getTitle()).trim().toUpperCase(), tipe = it.getType();
    if (judul === 'LOKASI' && tipe === FormApp.ItemType.TEXT) {
      var idx = it.getIndex();
      form.deleteItem(idx);
      pilihanLokasi = form.addListItem().setTitle('LOKASI').setHelpText('Lokasi sudah ditentukan untuk formulir ini.').setChoiceValues([lokasi]).setRequired(true);
      form.moveItem(pilihanLokasi.getIndex(), idx);
    } else if (judul === 'BAGIAN KERJA' && tipe === FormApp.ItemType.MULTIPLE_CHOICE && info.bagian.length) {
      it.asMultipleChoiceItem().setChoiceValues(info.bagian);
    } else if (judul === 'NAMA LENGKAP' && tipe === FormApp.ItemType.TEXT) {
      var cek = FormApp.createTextValidation().setHelpText('Tulis nama lengkap sesuai KTP, hanya huruf (minimal 3 karakter).')
        .requireTextMatchesPattern("^[A-Za-z][A-Za-z .,'-]{2,}$").build();
      it.asTextItem().setHelpText('Sesuai KTP, tanpa singkatan atau nama panggilan.').setValidation(cek).setRequired(true);
    }
  }

  // tanggapan masuk ke spreadsheet data (tab baru) supaya sinkronisasi Code.gs mengambilnya
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SPREADSHEET_DATA_ID);

  var isi = form.getPublishedUrl();
  if (pilihanLokasi) isi = form.createResponse().withItemResponse(pilihanLokasi.createResponse(lokasi)).toPrefilledUrl(); // lokasi sudah terpilih
  return { id: form.getId(), isi: isi, edit: form.getEditUrl() };
}

// ---------- bantuan ----------
function idTemplate_() {
  if (TEMPLATE_ID) return TEMPLATE_ID;
  var it = DriveApp.getFilesByName(NAMA_TEMPLATE);
  while (it.hasNext()) { var f = it.next(); if (f.getMimeType() === 'application/vnd.google-apps.form' && !f.isTrashed()) return f.getId(); }
  throw new Error('Form template "' + NAMA_TEMPLATE + '" tidak ditemukan di Drive akun ini. Isi TEMPLATE_ID.');
}

// lokasi_form -> { bagian: [..] } dari anggaran yang sama dengan yang dipakai web
function ambilLokasi_() {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/anggaran_publik?select=lokasi_form,bagian_kerja&order=lokasi_form,bagian_kerja', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('Gagal membaca daftar lokasi: ' + res.getResponseCode() + ' ' + res.getContentText());
  var peta = {};
  JSON.parse(res.getContentText()).forEach(function (r) {
    if (!r.lokasi_form) return;
    var o = peta[r.lokasi_form] || (peta[r.lokasi_form] = { bagian: [] });
    if (r.bagian_kerja && o.bagian.indexOf(r.bagian_kerja) < 0) o.bagian.push(r.bagian_kerja);
  });
  return peta;
}

function lembarLink_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('LINK_SS_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('LINK FORM SERAGAM 2027');
    props.setProperty('LINK_SS_ID', ss.getId());
    var s0 = ss.getSheets()[0]; s0.setName('Form per lokasi');
    s0.appendRow(['Lokasi', 'Bagian kerja', 'Tautan isi (bagikan ke karyawan)', 'Tautan edit (admin)', 'ID form', 'Dibuat']);
    s0.setFrozenRows(1); s0.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return ss.getSheets()[0];
}
