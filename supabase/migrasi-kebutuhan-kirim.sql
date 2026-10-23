-- Barang yang menunggu dikirim (belum masuk surat jalan) dari permintaan yang disetujui kedua pimpinan.
-- Tanpa nama karyawan, jadi aman dibaca halaman Pengiriman tanpa login; dipakai untuk mencocokkan dengan stok gudang.
create or replace function public.kebutuhan_kirim()
 returns table(id bigint, permintaan_id bigint, disetujui timestamptz, item_no int, item_nama text, qty int, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language sql stable security definer set search_path to 'public' as $f$
  select g.id, g.permintaan_id, coalesce(greatest(p.diputuskan_yasir, p.diputuskan_ferry), p.diputuskan, p.dibuat), g.item_no, g.item_nama, g.qty, g.ukuran_baju, g.ukuran_celana, g.ukuran_sepatu
  from public.ploting g join public.permintaan p on p.id = g.permintaan_id
  where p.status = 'disetujui' and not exists (select 1 from public.pengiriman_item pi where pi.ploting_id = g.id)
  order by 3, g.permintaan_id, g.id $f$;
revoke all on function public.kebutuhan_kirim() from public; grant execute on function public.kebutuhan_kirim() to anon;
