// Merapikan tab rekap "MONITORING CLIENT 2026 / REKAPITULASI SERAGAM".
//   rapikanRekapSimulasi() : hanya mencatat rencana di Log, tidak mengubah apa pun.
//   rapikanRekapTerapkan() : membuat tab cadangan, lalu menerapkan perubahan.
var REKAP_ID = '1EFXGh8J2f4QZf957zRmpP3dOuSv1wBydEiqeC1ZR218';
var REKAP_GID = 40720739;
var BARIS_DATA_AWAL = 4; // baris 1-2 judul, baris 3 header

var BAGIAN_FORM = [
  'KEAMANAN PRIA (SECURITY)', 'KEAMANAN WANITA(SECWAN)', 'KEBERSIHAN (CLEANING SERVICE)',
  'PENGEMUDI (DRIVER)', 'PRAMUBAKTI /ADMINISTRASI', 'PTSP', 'FO', 'PENGAWAS (LEADER)',
  'PRODUKSI', 'TEKNISI', 'SALES', 'TENAGA LAPANGAN'
];

function acak_(daftar) { return daftar[Math.floor(Math.random() * daftar.length)]; }

// Mengembalikan {hasil, jenis}: jenis = 'tetap' | 'perbaiki' | 'acak'
function petaBagian_(asli) {
  var teks = String(asli);
  if (BAGIAN_FORM.indexOf(teks.trim()) >= 0) return { hasil: teks.trim(), jenis: 'tetap' };
  var t = teks.toUpperCase().replace(/[^A-Z0-9 &]/g, ' ').replace(/\s+/g, ' ').trim();
  var aman = BAGIAN_FORM[0], bersih = BAGIAN_FORM[2], supir = BAGIAN_FORM[3], pramu = BAGIAN_FORM[4], awas = BAGIAN_FORM[7];
  if (/KEAMANAN/.test(t) && /KEBERSIH|&/.test(t)) return { hasil: acak_([aman, bersih]), jenis: 'acak' };
  if (/KEAMANAN/.test(t) && /PENGAWAS/.test(t)) return { hasil: acak_([aman, awas]), jenis: 'acak' };
  if (/KEBERSIH|KEBESIHAN|KEBERIHAN/.test(t)) return { hasil: bersih, jenis: 'perbaiki' };
  if (/KEAMANAN|PENJAGA MALAM|SECURITY/.test(t)) return { hasil: aman, jenis: 'perbaiki' };
  if (/PRAMU/.test(t)) return { hasil: pramu, jenis: 'perbaiki' };
  if (/DRIVER|PENGEMUDI|JUKIR/.test(t)) return { hasil: supir, jenis: 'perbaiki' };
  if (/PENGAWAS|LEADER/.test(t)) return { hasil: awas, jenis: 'perbaiki' };
  return { hasil: acak_(BAGIAN_FORM), jenis: 'acak' };
}

function adaAnggaran_(sel) {
  if (typeof sel === 'number') return sel > 0;
  var digit = String(sel).replace(/\D/g, '');
  return digit !== '' && Number(digit) > 0;
}

function rapikanRekapSimulasi() { prosesRekap_(false); }
function rapikanRekapTerapkan() { prosesRekap_(true); }

function prosesRekap_(terapkan) {
  var ss = SpreadsheetApp.openById(REKAP_ID);
  var sh = ss.getSheets().filter(function (s) { return s.getSheetId() === REKAP_GID; })[0];
  if (!sh) throw new Error('Tab dengan gid ' + REKAP_GID + ' tidak ditemukan.');
  if (String(sh.getRange(BARIS_DATA_AWAL - 1, 2).getValue()).trim().toUpperCase() !== 'NAMA CLIENT')
    throw new Error('Header tidak di baris ' + (BARIS_DATA_AWAL - 1) + '. Dibatalkan, tidak ada yang diubah.');

  var n = sh.getLastRow() - BARIS_DATA_AWAL + 1;
  var v = sh.getRange(BARIS_DATA_AWAL, 1, n, 5).getValues();
  var client = '', hapus = [], ubah = [], hitung = { tetap: 0, perbaiki: 0, acak: 0 }, acakLog = [];

  for (var i = 0; i < n; i++) {
    var r = v[i];
    if (String(r[1]).trim()) client = String(r[1]).trim();
    if (r.join('').trim() === '') continue;
    if (!adaAnggaran_(r[4])) { hapus.push(i); continue; }
    if (!String(r[2]).trim()) continue;
    var p = petaBagian_(r[2]);
    hitung[p.jenis]++;
    if (p.hasil !== String(r[2]).trim()) {
      ubah.push({ i: i, hasil: p.hasil });
      if (p.jenis === 'acak') acakLog.push(client + ': "' + r[2] + '" -> ' + p.hasil);
    }
  }

  Logger.log('Baris data: ' + n);
  Logger.log('Baris tanpa anggaran (dihapus): ' + hapus.length);
  hapus.forEach(function (i) { Logger.log('  baris ' + (BARIS_DATA_AWAL + i) + ': ' + (v[i][1] || '(lanjutan)') + ' | ' + v[i][2] + ' | anggota ' + v[i][3]); });
  Logger.log('Bagian kerja -> sudah sesuai: ' + hitung.tetap + ', diperbaiki: ' + hitung.perbaiki + ', diacak: ' + hitung.acak);
  acakLog.forEach(function (s) { Logger.log('  acak: ' + s); });
  if (!terapkan) { Logger.log('SIMULASI: tidak ada yang diubah.'); return; }

  // 1) cadangan
  var nama = 'BACKUP ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH.mm');
  sh.copyTo(ss).setName(nama);
  Logger.log('Cadangan dibuat: tab "' + nama + '"');

  // 2) ubah bagian kerja
  ubah.forEach(function (u) { sh.getRange(BARIS_DATA_AWAL + u.i, 3).setValue(u.hasil); });

  // 3) pindahkan NO + nama client bila baris pertamanya dihapus, lalu hapus dari bawah
  hapus.forEach(function (i) {
    if (!String(v[i][1]).trim()) return;
    for (var j = i + 1; j < n; j++) {
      if (hapus.indexOf(j) >= 0) continue;
      if (String(v[j][1]).trim()) break;
      if (v[j].join('').trim() === '') break;
      sh.getRange(BARIS_DATA_AWAL + j, 1, 1, 2).setValues([[v[i][0], v[i][1]]]);
      break;
    }
  });
  hapus.slice().reverse().forEach(function (i) { sh.deleteRow(BARIS_DATA_AWAL + i); });
  Logger.log('SELESAI. Diubah: ' + ubah.length + ' baris, dihapus: ' + hapus.length + ' baris.');
}
