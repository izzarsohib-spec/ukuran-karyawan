// Versi aplikasi. Naik 1 untuk setiap permintaan perubahan yang diselesaikan (angka sama dengan jumlah perubahan sejak awal, lihat CHANGELOG.md).
window.VERSI = { no: '1.182', tanggal: '2026-10-28', catatan: 'Surat ke pimpinan tampil langsung di aplikasi ntfy: tiap halaman JPG sebagai gambar' };
(function () {
  function pasang() {
    var el = document.getElementById('versi');
    if (!el) return;
    el.textContent = 'v' + window.VERSI.no;
    el.title = 'Versi ' + window.VERSI.no + ' · ' + window.VERSI.tanggal + '\n' + window.VERSI.catatan;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasang); else pasang();
})();
