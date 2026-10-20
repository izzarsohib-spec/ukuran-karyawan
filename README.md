# ukuran-karyawan

Data ukuran seragam karyawan per lokasi.

Alur: Google Form -> Spreadsheet -> Apps Script -> Supabase -> tabel web (GitHub Pages).

- `docs/` : halaman web (tanpa nama, hanya lokasi, bagian kerja, dan ukuran)
- `apps-script/` : skrip sinkron spreadsheet ke Supabase (kunci rahasia disimpan di Script Properties, bukan di repo)
- `supabase/` : skema database
