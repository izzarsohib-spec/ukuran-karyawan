-- PERALIHAN: semua fungsi yang tadinya meminta kode akses sekarang meminta login admin (lihat migrasi-login-admin.sql).
-- Parameter `kode` tetap ada supaya tanda tangan fungsi tidak berubah, tetapi isinya diabaikan.
-- Jalankan bersamaan dengan terbitnya halaman web yang memakai login (kalau lebih dulu, halaman lama berhenti bisa menyimpan).

create or replace function public._wajib_kode(kode text) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  if not public._adalah_admin() then raise exception 'kode akses: login admin diperlukan'; end if;
end $f$;
revoke all on function public._wajib_kode(text) from public, anon, authenticated;

create or replace function public.cek_kode(kode text) returns boolean
 language sql security definer set search_path to 'public','extensions' as $f$ select public._adalah_admin() $f$;

create or replace function public.daftar_nama(kode text)
 returns table(id bigint, waktu timestamptz, lokasi text, bagian_kerja text, nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language sql security definer set search_path to 'public','extensions' as $f$
  select u.id, u.waktu, u.lokasi, u.bagian_kerja, u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu
  from public.ukuran_pekerja u
  where public._adalah_admin()
  order by u.lokasi, u.id $f$;

create or replace function public.daftar_ukuran(kode text, p_lokasi text, p_bagian text)
 returns table(nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu
    from public.ukuran_pekerja u where u.lokasi = p_lokasi and u.bagian_kerja = p_bagian order by u.nama;
end $f$;

create or replace function public.ambil_ploting(kode text, p_permintaan bigint)
 returns table(nama text, item_no integer, item_nama text, qty integer, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select p.nama, p.item_no, p.item_nama, p.qty, p.ukuran_baju, p.ukuran_celana, p.ukuran_sepatu
    from public.ploting p where p.permintaan_id = p_permintaan order by p.nama, p.item_no;
end $f$;
