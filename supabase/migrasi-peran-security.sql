-- Peran security: di Google Form ada lima pilihan (Chief, Komandan Regu/Danru, Wakil Komandan Regu/Wadanru, Keamanan Pria, Keamanan Wanita),
-- tetapi anggaran (acuan_rekap) hanya mengenal SATU bagian: KEAMANAN PRIA (SECURITY). Agar semua terhitung di bagian itu (progres, permintaan,
-- ploting), bagian_kerja dinormalkan ke nama di anggaran dan pilihan asli Form disimpan di kolom `peran` untuk ditampilkan di web
-- (Chief, Danru, Wadanru, Anggota pria, Anggota wanita). Pilihan PRAMUBAKTI panjang di Form juga disamakan dengan nama di anggaran.

alter table public.ukuran_pekerja add column if not exists peran text;

create or replace function public.bagian_acuan(b text) returns text
 language sql immutable as $f$
  select case upper(regexp_replace(btrim(coalesce(b, '')), '\s+', ' ', 'g'))
    when 'CHIEF SECURITY' then 'KEAMANAN PRIA (SECURITY)'
    when 'KOMANDAN REGU SECURITY(DANRU)' then 'KEAMANAN PRIA (SECURITY)'
    when 'WAKIL KOMANDAN REGU (WADANRU)' then 'KEAMANAN PRIA (SECURITY)'
    when 'KEAMANAN WANITA(SECWAN)' then 'KEAMANAN PRIA (SECURITY)'
    when 'PRAMUBAKTI /ADMINISTRASI / PTSP / FO/STAFF' then 'PRAMUBAKTI /ADMINISTRASI'
    else b end $f$;

create or replace function public._normalkan_bagian() returns trigger
 language plpgsql as $f$
declare b text := upper(regexp_replace(btrim(coalesce(new.bagian_kerja, '')), '\s+', ' ', 'g'));
begin
  if b in ('CHIEF SECURITY', 'KOMANDAN REGU SECURITY(DANRU)', 'WAKIL KOMANDAN REGU (WADANRU)', 'KEAMANAN PRIA (SECURITY)', 'KEAMANAN WANITA(SECWAN)') then new.peran := b; end if;
  new.bagian_kerja := public.bagian_acuan(new.bagian_kerja);
  return new;
end $f$;
revoke all on function public._normalkan_bagian() from public, anon, authenticated;

drop trigger if exists normalkan_bagian on public.ukuran_pekerja;
create trigger normalkan_bagian before insert or update on public.ukuran_pekerja for each row execute function public._normalkan_bagian();

-- data yang sudah ada: isi peran dan normalkan bagian (log perubahan dimatikan sebentar agar tidak membanjiri riwayat)
alter table public.ukuran_pekerja disable trigger log_perubahan;
update public.ukuran_pekerja set bagian_kerja = bagian_kerja
  where upper(regexp_replace(btrim(coalesce(bagian_kerja, '')), '\s+', ' ', 'g')) in ('CHIEF SECURITY', 'KOMANDAN REGU SECURITY(DANRU)', 'WAKIL KOMANDAN REGU (WADANRU)', 'KEAMANAN PRIA (SECURITY)', 'KEAMANAN WANITA(SECWAN)', 'PRAMUBAKTI /ADMINISTRASI / PTSP / FO/STAFF');
alter table public.ukuran_pekerja enable trigger log_perubahan;

-- peran ikut terbaca web (view publik tanpa nama, dan dua fungsi yang memuat nama)
create or replace view public.ukuran_publik as
  select id, waktu, lokasi, bagian_kerja, ukuran_baju, ukuran_celana, ukuran_sepatu, peran
  from public.ukuran_pekerja where aktif;

drop function if exists public.daftar_nama(text);
create function public.daftar_nama(kode text)
 returns table(id bigint, waktu timestamp with time zone, lokasi text, bagian_kerja text, nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text, peran text)
 language sql security definer set search_path to 'public', 'extensions' as $f$
  select u.id, u.waktu, u.lokasi, u.bagian_kerja, u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu, u.peran
  from public.ukuran_pekerja u where public._adalah_admin() and u.aktif order by u.lokasi, u.id $f$;
revoke all on function public.daftar_nama(text) from public; grant execute on function public.daftar_nama(text) to anon, authenticated;

drop function if exists public.daftar_ukuran(text, text, text);
create function public.daftar_ukuran(kode text, p_lokasi text, p_bagian text)
 returns table(nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text, peran text)
 language plpgsql security definer set search_path to 'public', 'extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu, u.peran
    from public.ukuran_pekerja u where u.lokasi = p_lokasi and u.bagian_kerja = p_bagian and u.aktif order by u.nama;
end $f$;
revoke all on function public.daftar_ukuran(text, text, text) from public; grant execute on function public.daftar_ukuran(text, text, text) to anon, authenticated;
