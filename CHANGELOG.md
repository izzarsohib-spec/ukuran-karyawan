# Catatan Perubahan

Ringkasan perubahan sistem pengadaan (seragam, peralatan, chemical), dikelompokkan per tanggal dan dibangun dari riwayat commit. Yang terbaru di atas.

Nomor versi tampil di sidebar portal (kiri bawah) dan naik 1 untuk setiap permintaan perubahan yang selesai; sumbernya `docs/aset/versi.js`.

## 27 Okt 2026
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
