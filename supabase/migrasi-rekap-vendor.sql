-- Rekap ke vendor: jumlah barang per ukuran dari permintaan yang disetujui kedua pimpinan DAN PO-nya sudah ditandai terkirim ke vendor
-- (permintaan.po_dikirim, tanggal) dalam rentang tanggal tertentu. Hanya menjumlah (tanpa nama karyawan), seperti rekap_ukuran_disetujui().
-- Fungsi baru; tidak mengubah yang ada.
create or replace function public.rekap_ukuran_vendor(p_dari date, p_sampai date)
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
    and p.po_dikirim is not null and p.po_dikirim between p_dari and p_sampai
  group by u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran $f$;
revoke all on function public.rekap_ukuran_vendor(date, date) from public;
grant execute on function public.rekap_ukuran_vendor(date, date) to anon, authenticated;

-- Antrean rekap harian (jam 18.00): ukuran per permintaan yang sudah disetujui kedua pimpinan tetapi PO-nya BELUM ditandai terkirim ke vendor.
-- Menyertakan permintaan_id supaya web bisa menjumlah hanya permintaan yang dipilih. Tanpa nama karyawan (hanya jumlah), seperti rekap_ukuran_disetujui().
create or replace function public.rekap_ukuran_antrean()
 returns table(permintaan_id bigint, lokasi_form text, bagian_kerja text, item_no int, item_nama text, jenis text, ukuran text, qty bigint)
 language sql stable security definer set search_path to 'public' as $f$
  select u.permintaan_id, u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran, sum(u.qty)::bigint
  from (
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'baju'::text as jenis, g.ukuran_baju as ukuran, g.qty from public.ploting g where g.ukuran_baju is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'celana', g.ukuran_celana, g.qty from public.ploting g where g.ukuran_celana is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'sepatu', g.ukuran_sepatu, g.qty from public.ploting g where g.ukuran_sepatu is not null
  ) u
  join public.permintaan p on p.id = u.permintaan_id
  where coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui' and p.po_dikirim is null
  group by u.permintaan_id, u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran $f$;
revoke all on function public.rekap_ukuran_antrean() from public;
grant execute on function public.rekap_ukuran_antrean() to anon, authenticated;
