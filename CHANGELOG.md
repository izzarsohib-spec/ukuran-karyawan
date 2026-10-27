# Catatan Perubahan

Ringkasan perubahan sistem pengadaan (seragam, peralatan, chemical), dikelompokkan per tanggal dan dibangun dari riwayat commit. Yang terbaru di atas.

Nomor versi tampil di sidebar portal (kiri bawah) dan naik 1 untuk setiap permintaan perubahan yang selesai; sumbernya `docs/aset/versi.js`.

## 27 Okt 2026
- **v1.130** Sinkronisasi Form: mendukung kunci Supabase format baru (`sb_secret_...`) yang dikirim lewat header `apikey` saja, selain kunci lama (JWT).
- **v1.129** Sinkronisasi Form: kolom waktu juga dikenali bila berjudul "Cap waktu" (form berbahasa Indonesia); sebelumnya waktu pengisian dari form baru akan kosong.
- **v1.128** Tanggapan tiap form lokasi disimpan di spreadsheet sendiri (`TANGGAPAN <lokasi>`) di folder lokasinya dan didaftar di spreadsheet registri; sinkronisasi Supabase (`Code.gs`) membaca spreadsheet data lama ditambah semua spreadsheet di registri, bergiliran dengan batas waktu.
- **v1.127** `buatForm`: template yang sudah berisi pilihan LOKASI tunggal (hasil salinan form lokasi) didukung; pilihannya diganti nama lokasi tujuan.
- **v1.126** `buatForm`: parameter `deskripsi` kosong berarti memakai deskripsi template apa adanya (format tebal dari editor Forms tidak bisa dibuat lewat kode).
- **v1.125** Aksi `buatForm`: menambah gambar tabel ukuran sepatu pada halaman ukuran sepatu, deskripsi dan daftar bagian kerja bisa dikirim sebagai parameter; aksi `setDeskripsi` untuk menguji format deskripsi.
- **v1.124** Aksi `buatForm`: form salinan diterbitkan (Google meminta form diterbitkan sebelum diatur) dan salinan setengah jadi dibuang bila gagal, supaya bisa diulang.
- **v1.123** Form lama di folder arsip (311) dipindah ke Sampah Drive; Apps Script arsip Drive menambah aksi `buatForm` untuk membuat Google Form pendataan per lokasi (batas 1 tanggapan, login Google) langsung di folder lokasinya.
- **v1.122** Apps Script: aksi `buangForm` (Google Form saja, ke Sampah, butuh konfirmasi) untuk mengganti form lama; skrip pembuat form menaruh form baru di subfolder lokasinya.
- **v1.121** Apps Script arsip Drive: tambah aksi daftar isi, baca berkas, dan unggah berkas, terbatas di dalam folder utama (tanpa hapus/pindah/timpa). Petunjuk di `apps-script/PETUNJUK.md`.
- **v1.120** Skrip Apps Script `apps-script/buat-form-lokasi.gs`: membuat Google Form pengisian ukuran per lokasi dari form template, wajib login Google dengan batas 1 tanggapan per akun, lokasi dan bagian kerja berupa pilihan, nama wajib huruf; tautan dicatat di spreadsheet. Petunjuk di `apps-script/PETUNJUK.md`.
- **v1.119** Koreksi admin atas data karyawan permanen: baris yang diedit di Administrator dikunci sehingga sinkronisasi Google Form tiap jam tidak menimpanya; baris asal Form yang dihapus admin ditandai dibatalkan (tidak muncul lagi saat sinkronisasi). SQL: `supabase/migrasi-kunci-sinkron.sql` (sudah diterapkan).
- **v1.118** Monitoring Pengisian: ringkasan dan kartu progres PIC dihitung per LOKASI (bukan karyawan) dengan empat tahap berwarna: biru sudah lengkap, kuning sudah mengisi (terisi 50% atau lebih), oranye proses (di bawah 50%), merah belum mengisi sama sekali. Batang per PIC berupa susunan keempat warna itu.
- **v1.117** Monitoring Pengisian: ringkasan menambah angka "Sudah lengkap" (lokasi yang semua karyawannya sudah mengisi); tiap PIC di kartu progres menampilkan rincian lokasi lengkap / masih kurang / masih kosong dengan warna yang sama dengan ringkasan.
- **v1.116** Kartu "Progres pengisian per PIC" selalu menampilkan semua PIC (tidak lagi menyusut jadi satu PIC saat filter Area/PIC di atas halaman aktif); kartu "Lokasi siap diproses" rata atas.
- **v1.115** Penyegaran otomatis tiap 30 detik diperluas ke semua halaman: Seragam (termasuk stok, pengiriman, tagihan bila tidak ada form terbuka), Peralatan, dan Administrator (tabel yang tampil, dilewati saat ada baris diedit). Digambar ulang hanya bila data berubah.
- **v1.114** Seragam: data pengisian dan status permintaan disegarkan otomatis tiap 30 detik tanpa memuat ulang halaman (dilewati saat tab tersembunyi, kursor di kolom isian, atau jendela terbuka); keterangan waktu pembaruan terakhir di halaman Monitoring.
- **v1.113** Kartu "Progres pengisian per PIC": semua PIC lapangan tampil (termasuk yang belum memegang lokasi), tombol Ingatkan per PIC di kanan bar (membuka jendela pesan khusus PIC itu), keterangan angka dipindah ke bawah bar.
- **v1.112** Monitoring Pengisian: kartu "Progres pengisian per PIC" (batang sudah/belum mengisi, tombol Ingatkan PIC) dan "Lokasi siap diproses" (lokasi lengkap yang permintaan seragamnya belum dibuat, klik untuk membuat permintaan); keduanya ikut chip area.
- **v1.111** Monitoring Pengisian: grafik "Pengisian 30 hari terakhir" diganti grafik batang 5 lokasi dengan karyawan terbanyak yang belum mengisi; chip area (Semarang, Magelang, Kalimantan) menyaring grafik dan kartu "Belum mengisi", klik batang membuka lokasinya di daftar.
- **v1.110** Monitoring Pengisian: empat angka ringkasan (target, sudah mengisi, lokasi kurang, lokasi kosong) diberi satuan dan penjelasan singkat agar jelas dibaca sekilas.
- **v1.109** Monitoring Pengisian: kartu "Total anggaran RAB" diganti jumlah karyawan yang sudah mengisi dibandingkan total karyawan.
- **v1.108** Sidebar portal dibuat ringkas (128 px): judul panjang disembunyikan, logo di atas nama perusahaan, label menu mudah dibaca.
- **v1.107** Sidebar portal diperkecil lagi (184 px -> 156 px).
- **v1.106** Sidebar portal dibuat lebih kecil (lebar 252 px -> 184 px, menu dan logo lebih ramping).

## 26 Okt 2026
- **v1.105** Nomor versi ditampilkan di sidebar portal (arahkan kursor untuk melihat tanggal dan catatannya).
- **v1.104** Tambah CHANGELOG.md.
- Tanda tangan digital pimpinan di memo, PO, dan Daftar Harga.

## 24 Okt 2026
- Pengingat WA: mode uji (semua pesan PIC dan vendor dialihkan ke satu nomor).
- Administrator: menu per bidang (Seragam, Peralatan, Chemical, Organisasi, Sistem) di bar atas portal; tabel muat dengan batang gulir terlihat; header tabel satu baris dan rata.
- Rapikan grafik Dashboard Utama seragam dan kartu Tahap 3 Pengiriman.

## 23 Okt 2026
- **Audit (T1-T6, S1-S7, S9-S10, R1-R5):** komponen seragam eksplisit; ukuran XXXXL (L4=XXXL, L5=XXXXL); cegah pesanan ganda dan kirim ulang notifikasi; konfirmasi Setujui, tarik permintaan, pengingat pimpinan (nonaktif); PO dikirim ke vendor sebelum kekurangan dihitung; log hasil kirim WhatsApp dan alarm ntfy admin; validasi supplier, deteksi nama mirip, konfirmasi melebihi target/RAB, tanggal WIB, pelacakan aksesoris, ringkasan harian admin.
- **Kekurangan vendor:** hitung dipesan vs diterima per jenis dan ukuran, tagih kepastian kirim, janji kirim, estimasi kirim per barang, pengingat deadline (manual dan otomatis H-2/H-1), riwayat pengiriman, pesanan susulan menambah kekurangan otomatis.
- **Permintaan:** form digabung dengan pembagian per karyawan; permintaan bertahap (sebagian, sisanya menyusul); rekap barang dipecah per jenis; halaman Rekap Permintaan (per jenis, ukuran, lokasi, CSV).
- **Ploting:** prioritas lokasi lengkap, kelompok per PIC, catatan perakitan 1 stel (PDF), PDF penyiapan gudang beberapa lokasi.
- **Pengiriman dan Penerimaan:** panel stok gudang vs barang menunggu, tombol Kirim yang tersedia; form penerimaan untuk penerima (kamera, foto), berita acara PDF; halaman Stock Opname.
- **Organisasi:** area bertingkat (Semarang Barat/Timur/Selatan/Kota), pembagian PIC, filter Area/Sub-area/PIC.
- **Navigasi:** portal dengan sidebar bersih, tab bergaris bawah, tombol Filter PIC; Seragam kembali lima halaman gabungan.
- **Ingatkan PIC:** per lokasi dan per bagian kerja lewat WA bot (n8n), pesan panjang dipecah otomatis.

## 22 Okt 2026
- Portal dengan sidebar dan login admin menggantikan kode akses bersama; halaman Administrator (data acuan, karyawan masuk/keluar, log perubahan, cabang, PIC lapangan, penugasan).
- Halaman utama dengan bidang Seragam, Peralatan, Chemical (segera).
- **Peralatan:** permintaan, persetujuan pimpinan, anggaran lokasi, riwayat, surat PDF, dashboard, kelola data.
- Alasan revisi pimpinan, retur, stock opname, tagihan vendor.
- Rumus sisa RAB dan untung diseragamkan di form, PDF, notifikasi, dan dashboard.
- Surat di HP bisa diperbesar; sidebar melebar saat disentuh.

## 21 Okt 2026
- Web multi halaman: Monitoring Pengisian dan Permintaan Seragam.
- Permintaan dikirim ke pimpinan via ntfy; persetujuan dua pimpinan; PDF lampiran 5 bagian (Memo, PO, Daftar Harga, Data Ukuran, RAB); surat dibuka sebagai halaman web.
- Ploting, Inventaris, Pengiriman, Tagihan (surat jalan, invoice, pembayaran).
- Dashboard Ringkasan 5 bagian, mini dashboard per halaman, Laporan Harian PDF.
- Arsip memo dan invoice ke Google Drive per folder lokasi (menunggu pemasangan Apps Script).

## 20 Okt 2026
- Web tabel, skrip Apps Script, skema Supabase.
- Dashboard progres pengisian, notifikasi kekurangan, redesain bergaya dark glass, anggaran RAB per lokasi.
