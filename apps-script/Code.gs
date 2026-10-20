// Menyalin jawaban semua tab spreadsheet ke tabel Supabase `ukuran_pekerja`.
// Rahasia (SUPABASE_URL, SUPABASE_SERVICE_KEY) disimpan di Script Properties, bukan di kode ini.
var SPREADSHEET_ID = '1UMLvjFVYAJrsQh_6k8WU0B1c03lJQdstkJsV4GmCVSE';
var BATCH = 500;

function sinkronSemua() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Isi SUPABASE_URL dan SUPABASE_SERVICE_KEY di Script Properties.');

  var rows = [];
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().forEach(function (sh) {
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
        kunci: sh.getName() + '|' + (iso || r) + '|' + nama,
        waktu: iso,
        lokasi: String(row[i.lokasi] || sh.getName()).trim(),
        bagian_kerja: String(row[i.bagian] || '').trim(),
        nama: nama,
        ukuran_baju: String(row[i.baju] || '').trim(),
        ukuran_celana: String(row[i.celana] || '').trim(),
        ukuran_sepatu: String(row[i.sepatu] || '').trim(),
        sumber_tab: sh.getName()
      });
    }
  });

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

// Jalankan sekali untuk membuat jadwal otomatis (tiap 1 jam).
function pasangJadwal() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sinkronSemua').timeBased().everyHours(1).create();
}
