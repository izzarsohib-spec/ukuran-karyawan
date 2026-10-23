-- Rekap Permintaan: jumlah barang per ukuran dari SEMUA permintaan yang sudah disetujui kedua pimpinan.
-- Hanya menjumlah (tanpa nama karyawan), jadi boleh dibaca publik seperti daftar_permintaan(). Menambah satu fungsi baru; tidak mengubah yang ada.
-- Ukuran diambil dari pembagian per karyawan (tabel ploting): baju, celana, dan sepatu dihitung sebagai jenis masing-masing.
create or replace function public.rekap_ukuran_disetujui()
 returns table(lokasi_form text, bagian_kerja text, item_no int, item_nama text, jenis text, ukuran text, qty bigint)
 language sql stable security definer set search_path to 'public' as $f$
  select u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran, sum(u.qty)::bigint
  from (
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'baju'::text as jenis, g.ukuran_baju as ukuran, g.qty from public.ploting g where g.ukuran_baju is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'celana', g.ukuran_celana, g.qty from public.ploting g where g.ukuran_celana is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'sepatu', g.ukuran_sepatu, g.qty from public.ploting g where g.ukuran_sepatu is not null
  ) u
  join public.permintaan p on p.id = u.permintaan_id
  where coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui'
  group by u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran $f$;
revoke all on function public.rekap_ukuran_disetujui() from public;
grant execute on function public.rekap_ukuran_disetujui() to anon, authenticated;
