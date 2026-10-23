-- Waktu data Form terakhir masuk ke database (untuk menandai data yang basi karena sinkron Apps Script berhenti)
create or replace function public.sinkron_terakhir() returns timestamptz
 language sql stable security definer set search_path to 'public' as $f$ select max(diperbarui) from public.ukuran_pekerja $f$;
revoke all on function public.sinkron_terakhir() from public; grant execute on function public.sinkron_terakhir() to anon, authenticated;
