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