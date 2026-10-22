# ukuran-karyawan

Data ukuran seragam karyawan per lokasi.

Alur: Google Form -> Spreadsheet -> Apps Script -> Supabase -> tabel web (GitHub Pages).

- `docs/` : halaman web. `index.html` = halaman utama (pilih bidang: Seragam, Peralatan, Chemical); `seragam/` = aplikasi seragam; `aset/`, `surat.html`, `revisi.html` dipakai bersama (tautan notifikasi pimpinan menunjuk ke root `docs/`, jangan dipindah)
- `apps-script/` : skrip sinkron spreadsheet ke Supabase (kunci rahasia disimpan di Script Properties, bukan di repo)
- `supabase/` : skema database
