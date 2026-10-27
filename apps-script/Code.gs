// Menyalin jawaban semua tab spreadsheet ke tabel Supabase `ukuran_pekerja`.
// Rahasia (SUPABASE_URL, SUPABASE_SERVICE_KEY) disimpan di Script Properties, bukan di kode ini.
var SPREADSHEET_ID = '1UMLvjFVYAJrsQh_6k8WU0B1c03lJQdstkJsV4GmCVSE';
var BATCH = 500;

var REGISTRI_ID = ''; // spreadsheet "REGISTRI TANGGAPAN FORM" (dibuat oleh skrip arsip Drive saat membuat form per lokasi); kosong = dilewati
var BATAS_REGISTRI_MS = 4 * 60 * 1000;

// Membaca satu tab jawaban Form dan menambahkannya ke rows. awalan = awal kunci unik; lokasiCadangan dipakai bila kolom LOKASI kosong.
function kumpul_(sh, awalan, lokasiCadangan, sumberTab, rows) {
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return;
  var h = v[0].map(function (x) { return String(x).trim().toUpperCase(); });
  var i = {
    waktu: h.indexOf('TIMESTAMP'),
    bagian: h.indexOf('BAGIAN KERJA'),
    nama: h.indexOf('NAMA LENGKAP'),
    lokasi: h.indexOf('LOKASI'),
    baju: h.indexOf('UKURAN BAJU'),
    celana: h.findIndex(function (x) { return x.indexOf('UKURAN CELANA') === 0; }),
    sepatu: h.findIndex(function (x) { return x.indexOf('UKURAN SEPATU') === 0; })
  };
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    if (!row.join('').trim()) continue;
    var w = row[i.waktu];
    var iso = w instanceof Date ? w.toISOString() : null;
    var nama = String(row[i.nama] || '').trim();
    rows.push({
      kunci: awalan + '|' + (iso || r) + '|' + nama,
      waktu: iso,
      lokasi: String(row[i.lokasi] || lokasiCadangan).trim(),
      bagian_kerja: String(row[i.bagian] || '').trim(),
      nama: nama,
      ukuran_baju: String(row[i.baju] || '').trim(),
      ukuran_celana: String(row[i.celana] || '').trim(),
      ukuran_sepatu: String(row[i.sepatu] || '').trim(),
      sumber_tab: sumberTab
    });
  }
}

// Spreadsheet tanggapan dibaca bergiliran dengan batas waktu; putaran berikutnya melanjutkan dari yang belum terbaca (REG_OFFSET).
function tanggapanRegistri_(rows) {
  if (!REGISTRI_ID) return;
  var daftar = SpreadsheetApp.openById(REGISTRI_ID).getSheets()[0].getDataRange().getValues().slice(1).filter(function (r) { return r[2]; });
  var n = daftar.length; if (!n) return;
  var props = PropertiesService.getScriptProperties(), off = Number(props.getProperty('REG_OFFSET')) || 0;
  var mulai = Date.now(), terbaca = 0, gagal = 0;
  for (var k = 0; k < n; k++) {
    if (Date.now() - mulai > BATAS_REGISTRI_MS) break;
    var r = daftar[(off + k) % n];
    try {
      SpreadsheetApp.openById(String(r[2])).getSheets().forEach(function (sh) { kumpul_(sh, String(r[2]), String(r[0]), String(r[0]) + ' (form)', rows); });
      terbaca++;
    } catch (e) { gagal++; Logger.log('Gagal membaca tanggapan ' + r[0] + ': ' + e); }
  }
  props.setProperty('REG_OFFSET', String((off + terbaca + gagal) % n));
  Logger.log('Tanggapan form: ' + terbaca + ' dari ' + n + ' spreadsheet terbaca' + (gagal ? ', ' + gagal + ' gagal' : '') + (terbaca + gagal < n ? ' (sisanya putaran berikutnya)' : ''));
}

function sinkronSemua() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Isi SUPABASE_URL dan SUPABASE_SERVICE_KEY di Script Properties.');

  var rows = [];
  // 1) spreadsheet data lama: semua tab (tanggapan form lama dan data uji)
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().forEach(function (sh) { kumpul_(sh, sh.getName(), sh.getName(), sh.getName(), rows); });
  // 2) tanggapan form per lokasi: tiap form punya spreadsheet sendiri di folder lokasinya, didaftar di registri
  tanggapanRegistri_(rows);

  for (var s = 0; s < rows.length; s += BATCH) {
    var res = UrlFetchApp.fetch(url + '/rest/v1/ukuran_pekerja?on_conflict=kunci', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(rows.slice(s, s + BATCH)),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  Logger.log('Sinkron selesai: ' + rows.length + ' baris');
}

// Periksa tiap langkah dan laporkan statusnya (tanpa menampilkan rahasia).
function diagnosa() {
  var out = {};
  try {
    var p = PropertiesService.getScriptProperties();
    out.SUPABASE_URL_terisi = !!p.getProperty('SUPABASE_URL');
    out.SUPABASE_SERVICE_KEY_terisi = !!p.getProperty('SUPABASE_SERVICE_KEY');
  } catch (e) { out.properties_error = String(e); }
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    out.spreadsheet = ss.getName();
    out.jumlah_tab = ss.getSheets().length;
  } catch (e) { out.spreadsheet_error = String(e); }
  try { out.akun_penjalan = Session.getEffectiveUser().getEmail(); } catch (e) { out.akun_error = String(e); }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Jalankan sekali untuk membuat jadwal otomatis (tiap 1 jam).
function pasangJadwal() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sinkronSemua').timeBased().everyHours(1).create();
}
