-- Tanda tangan PIC (pic.png) di bucket privat 'tanda-tangan': hanya admin yang login (lewat sesi Supabase Auth) boleh membacanya.
-- Fungsi pembungkus dipakai karena peran 'authenticated' tidak boleh memanggil public._adalah_admin() langsung.
create or replace function public._admin_baca_ttd() returns boolean language sql security definer set search_path to 'public','extensions' as $f$ select public._adalah_admin() $f$;
revoke all on function public._admin_baca_ttd() from public, anon;
grant execute on function public._admin_baca_ttd() to authenticated;
drop policy if exists "admin baca tanda tangan pic" on storage.objects;
create policy "admin baca tanda tangan pic" on storage.objects for select to authenticated
  using (bucket_id = 'tanda-tangan' and name = 'pic.png' and public._admin_baca_ttd());