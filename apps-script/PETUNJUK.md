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

## Akses admin ke isi folder (daftar isi, baca, unggah)
Web App yang sama menerima tiga aksi tambahan lewat POST JSON (dengan token yang sama), semuanya TERBATAS di dalam folder utama dan turunannya:
- `{"token":"...","aksi":"pohon","id":"<folderId, opsional>","kedalaman":1-4}` mendaftar folder dan berkas.
- `{"token":"...","aksi":"baca","id":"<berkasId>"}` mengambil isi: teks untuk Doc, Sheet (CSV), dan teks biasa; base64 untuk berkas lain (maks. 8 MB).
- `{"token":"...","aksi":"unggah","id":"<folderId, opsional>","nama":"x.pdf","isi":"<base64>","mime":"application/pdf"}` membuat berkas baru; nama yang sama tidak ditimpa (yang lama diberi tanda "lama").
Tidak ada aksi menghapus atau memindah. Setelah menempel versi baru, buka Terapkan > Kelola deployment > ikon pensil > Versi baru > Terapkan (URL /exec tetap sama),
dan setujui izin tambahan (koneksi eksternal) bila diminta. Layanan "Drive API" (v3) harus sudah ditambahkan.
- `{"token":"...","aksi":"buangForm","ids":["<formId>",...],"konfirmasi":"HAPUS FORM"}` memindahkan Google Form yang disebut ke Sampah (bisa dipulihkan 30 hari). Hanya Google Form, hanya di dalam folder utama, maksimal 100 id per panggilan, tidak ada penghapusan permanen.
- `{"token":"...","aksi":"buatForm","lokasi":"<nilai LOKASI>","folderId":"<folder lokasi>","judul":"DATA SERAGAM <lokasi>","bagian":["..."]}` membuat satu Google Form dari template di folder itu (dilewati bila sudah ada form bernama sama). Butuh izin Forms dan Spreadsheet: setelah push, jalankan `izinkan` dari editor sekali lalu terapkan versi baru.
