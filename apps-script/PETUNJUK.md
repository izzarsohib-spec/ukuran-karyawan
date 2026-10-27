# Arsip dokumen ke Google Drive

Memo (saat dikirim ke pimpinan) dan invoice (saat dibuat) otomatis disimpan sebagai PDF di folder lokasinya di Google Drive.
Nama file: `<lokasi> <bagian> - memo.pdf` dan `<lokasi> <bagian> - invoice.pdf`, misalnya `atr bpn wonogiri keamanan - memo.pdf`.

Alurnya: web -> fungsi server `arsip-drive` (Supabase) -> Apps Script ini (jalan di akun Google pemilik folder) -> Drive.
Apps Script dilindungi token rahasia yang sama dengan rahasia Supabase `ARSIP_TOKEN`, jadi alamat Web App tidak berguna bagi orang lain.

## Pemasangan (sekali saja)
1. Buka https://script.google.com, klik Proyek baru, hapus isi bawaan, tempel seluruh isi file `arsip-drive.gs` (salinan yang sudah berisi token ada di komputer PIC, bukan di repo).
2. Di bilah kiri editor klik **Layanan (+)**, pilih **Drive API** (versi v3), lalu **Tambahkan**. Layanan ini membuat pencarian folder cepat (1 detik, bukan 1 menit).
3. Pilih fungsi `izinkan` lalu klik Jalankan. Setujui izin akses Drive. Hasilnya (nama folder utama dan subfolder) muncul di Log eksekusi.
4. Terapkan > Deployment baru > jenis Aplikasi web. Jalankan sebagai: Saya. Yang memiliki akses: Siapa saja. Salin URL yang berakhiran `/exec`.
5. Pasang rahasia Supabase `ARSIP_URL` (URL tadi) dan `ARSIP_TOKEN` (token yang sama dengan di skrip).

## Aturan pencocokan folder
Nama lokasi dibandingkan dengan nama subfolder (sampai 2 tingkat di bawah folder utama). Kata umum seperti BPN, KOTA, KAB, PROV diabaikan,
jadi `ATR/BPN WONOGIRI` cocok dengan folder `ATR WONOGIRI`. Jika tidak ada yang cocok, dibuat folder baru bernama lokasi tersebut.
File lama dengan nama sama tidak dihapus, hanya diberi tanda `(lama tanggal jam)`.

Periksa daftar folder yang terbaca: `<URL /exec>?token=<TOKEN>` (GET). Uji satu lokasi: tambahkan `&aksi=cocok&lokasi=ATR/BPN WONOGIRI`.
# Form pengisian ukuran per lokasi (`buat-form-lokasi.gs`)
Membuat satu Google Form per lokasi dari form template "Template Form Pengisian Data Seragam Karyawan", dengan pencegahan data ganda:
wajib login Google + email terverifikasi, **batas 1 tanggapan per akun**, tanggapan tidak bisa diedit sendiri (koreksi lewat admin di halaman Administrator),
pertanyaan LOKASI jadi pilihan tunggal (tidak bisa salah ketik), pilihan BAGIAN KERJA dibatasi sesuai anggaran lokasi, NAMA LENGKAP wajib huruf (min. 3 karakter).
Tanggapan masuk ke spreadsheet data sehingga sinkronisasi `Code.gs` tidak perlu diubah.

1. Buka script.google.com dengan akun pemilik form template, Proyek baru, tempel isi `buat-form-lokasi.gs` (salinan siap tempel ada di folder Documents).
2. Pilih fungsi `buatContoh`, Jalankan, setujui izin (Forms, Drive, Spreadsheet, koneksi eksternal). Satu form dibuat untuk lokasi pertama (urut abjad).
3. Periksa form contoh lewat spreadsheet "LINK FORM SERAGAM 2027" (dibuat otomatis): buka tautan isi, coba isi dua kali dengan akun yang sama (kedua harus ditolak).
4. Bila sudah sesuai, jalankan `buatSemua`. Bila waktu habis (batas 6 menit) jalankan lagi; lokasi yang sudah punya form dilewati.
5. Bagikan kolom "Tautan isi" tiap lokasi ke PIC/karyawan. Tautan itu sudah memilih lokasinya.

Catatan: tiap form menambah satu tab di spreadsheet data; Google Sheets membatasi jumlah tab, jadi bila terlalu banyak, ubah `SPREADSHEET_DATA_ID` ke spreadsheet lain
(dan tambahkan ID-nya ke `Code.gs` agar ikut disinkronkan). Menghapus tanggapan di Form (oleh admin) membuat akun itu bisa mengisi sekali lagi.
