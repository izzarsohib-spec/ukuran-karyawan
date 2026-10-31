// Versi aplikasi. Naik 1 untuk setiap permintaan perubahan yang diselesaikan (angka sama dengan jumlah perubahan sejak awal, lihat CHANGELOG.md).
window.VERSI = { no: '1.305', tanggal: '2026-10-31', catatan: 'Permintaan: mini dashboard jadi Pantau pembuatan surat dan persetujuan pimpinan (3 gauge)' };
(function () {
  function pasang() {
    var el = document.getElementById('versi');
    if (!el) return;
    el.textContent = 'v' + window.VERSI.no;
    el.title = 'Versi ' + window.VERSI.no + ' · ' + window.VERSI.tanggal + '\n' + window.VERSI.catatan;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasang); else pasang();
})();
