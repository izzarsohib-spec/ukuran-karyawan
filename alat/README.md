# alat/

## cek-tata-letak.mjs

Pemeriksa tata letak otomatis untuk web administrasi pengadaan (halaman modul Seragam). Membuka tiap halaman di Chrome, lalu melaporkan masalah tampilan. Butuh **Node 22+** dan **Google Chrome**; tidak perlu instal paket apa pun.

```
node alat/cek-tata-letak.mjs                                   # situs langsung, semua halaman, layar 1500x1000
node alat/cek-tata-letak.mjs --halaman datang,kurang,retur     # sebagian halaman
node alat/cek-tata-letak.mjs --lebar 1366 --tinggi 768         # ukuran layar lain
node alat/cek-tata-letak.mjs --url http://localhost:8000/seragam/   # versi lokal
node alat/cek-tata-letak.mjs --keluar alat/hasil --json alat/hasil/laporan.json   # simpan tangkapan layar dan laporan
```

Tingkat temuan:
- **KRITIS**: kontrol keluar dari kartunya, isi terpotong (overflow tersembunyi), error JavaScript. Kode keluar 1 bila ada.
- **PERINGATAN**: tabel yang harus digeser ke samping, teks dropdown terpotong.
- **INFO**: halaman bergulir melebihi layar, kartu `.k3` dengan ruang kosong besar atau sudut atau latar tidak sama dengan acuan (16px, putih), huruf kecil dari 10,5px.

Acuan gaya: halaman **Monitoring pengisian** (kartu putih polos di atas latar halaman: sudut 16px, padding 20px 22px, garis tipis #DCE3EC, bayangan halus, judul 15px). Susunan kolom Barang datang dan kawan-kawan tetap tutorial di kiri. Jalankan sebelum push setelah mengubah halaman mana pun; temuan INFO "ruang kosong" pada kartu yang memang kosong (belum ada data) bisa diabaikan.
