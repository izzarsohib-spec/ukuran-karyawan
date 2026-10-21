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

// semua subfolder langsung di bawah folder utama (satu folder per lokasi)
function daftarFolder_() {
  var hasil = [], a = DriveApp.getFolderById(FOLDER_UTAMA).getFolders();
  while (a.hasNext()) { var f = a.next(); hasil.push({ folder: f, nama: f.getName(), jalur: f.getName() }); }
  return hasil;
}
function cariFolder_(lokasi) {
  var semua = daftarFolder_(), i, kl = kata_(lokasi);
  for (i = 0; i < semua.length; i++) if (norm_(semua[i].nama) === norm_(lokasi)) return { folder: semua[i].folder, jalur: semua[i].jalur, baru: false };
  var nilai = semua.map(function (x) { return { x: x, s: skor_(kata_(x.nama), kl) }; }).sort(function (p, q) { return q.s - p.s; });
  if (!nilai.length || nilai[0].s < AMBANG) return null;
  if (nilai[1] && nilai[1].s === nilai[0].s) return null;
  return { folder: nilai[0].x.folder, jalur: nilai[0].x.jalur, baru: false };
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
    if (!d.lokasi || !d.nama || !d.pdf) return jawab_({ ok: false, error: 'data kurang' });
    var tujuan = cariFolder_(d.lokasi);
    if (!tujuan) {
      var baru = DriveApp.getFolderById(FOLDER_UTAMA).createFolder(String(d.lokasi).toUpperCase());
      tujuan = { folder: baru, jalur: baru.getName(), baru: true };
    }
    var nama = String(d.nama).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
    // file lama dengan nama sama tidak dihapus, hanya diberi tanda "lama" supaya riwayatnya tetap ada
    var lama = tujuan.folder.getFilesByName(nama), stempel = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HHmm');
    while (lama.hasNext()) { var f = lama.next(); f.setName(nama.replace(/\.pdf$/, '') + ' (lama ' + stempel + ').pdf'); }
    var file = tujuan.folder.createFile(Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', nama));
    return jawab_({ ok: true, folder: tujuan.jalur, folderBaru: tujuan.baru, nama: nama, url: file.getUrl() });
  } catch (err) { return jawab_({ ok: false, error: String(err) }); }
}

// Jalankan SEKALI dari editor (tombol Run) untuk memberi izin akses Drive.
function izinkan() {
  Logger.log('Folder utama: ' + DriveApp.getFolderById(FOLDER_UTAMA).getName());
  Logger.log('Subfolder: ' + daftarFolder_().map(function (x) { return x.jalur; }).join(' | '));
}
