// Versi aplikasi. Naik 1 untuk setiap permintaan perubahan yang diselesaikan (angka sama dengan jumlah perubahan sejak awal, lihat CHANGELOG.md).
window.VERSI = { no: '1.128', tanggal: '2026-10-27', catatan: 'Tanggapan form per lokasi disimpan di folder lokasinya; sinkronisasi membaca lewat registri' };
(function () {
  function pasang() {
    var el = document.getElementById('versi');
    if (!el) return;
    el.textContent = 'v' + window.VERSI.no;
    el.title = 'Versi ' + window.VERSI.no + ' · ' + window.VERSI.tanggal + '\n' + window.VERSI.catatan;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasang); else pasang();
})();
