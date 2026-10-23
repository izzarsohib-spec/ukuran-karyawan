-- Komponen tiap seragam dibuat eksplisit (bukan tebakan dari nama): menentukan ukuran apa yang diminta
-- (baju / celana / sepatu) dan cara setelan dipecah di rekap, PO, dan kekurangan vendor.
alter table public.harga_seragam add column if not exists komponen text;
update public.harga_seragam set komponen = case
  when kategori = 'Sepatu' or nama ~* 'SEPATU' then 'sepatu'
  when kategori = 'Aksesoris' then 'aksesoris'
  when nama ~* '^CELANA' then 'celana'
  when kategori = 'Baju saja' or nama ~* '^(KAOS|ATASAN)' then 'baju'
  else 'baju+celana' end
where komponen is null;
update public.harga_seragam set komponen = 'baju+celana' where nama = 'BAJU TEKNISI' and kategori = 'Seragam setelan'; -- harga setelan (Rp180 rb), bukan baju saja (no. 41)
alter table public.harga_seragam alter column komponen set default 'baju+celana';
alter table public.harga_seragam alter column komponen set not null;
alter table public.harga_seragam drop constraint if exists harga_seragam_komponen_cek;
alter table public.harga_seragam add constraint harga_seragam_komponen_cek check (komponen in ('baju','celana','baju+celana','sepatu','aksesoris'));

drop function if exists public.admin_daftar_harga_seragam();
create function public.admin_daftar_harga_seragam()
 returns table(no int, kategori text, nama text, harga_beli int, harga_jual int, dipakai int, komponen text)
 language sql security definer set search_path to 'public' as $f$
  select h.no, h.kategori, h.nama, h.harga_beli, h.harga_jual,
    (select count(*)::int from public.permintaan p, jsonb_array_elements(p.items) e where (e ->> 'no') ~ '^\d+$' and (e ->> 'no')::int = h.no)
    + (select count(*)::int from public.stok_gerak s where s.item_no = h.no), h.komponen
  from public.harga_seragam h order by h.no $f$;
revoke all on function public.admin_daftar_harga_seragam() from public; grant execute on function public.admin_daftar_harga_seragam() to anon, authenticated;

drop function if exists public.admin_simpan_harga_seragam(text,int,text,text,int,int);
create function public.admin_simpan_harga_seragam(kode text, p_no int, p_kategori text, p_nama text, p_beli int, p_jual int, p_komponen text default 'baju+celana') returns int
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); rid int; k text := coalesce(nullif(trim(p_komponen), ''), 'baju+celana');
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama seragam wajib diisi'; end if;
  if coalesce(nullif(trim(p_kategori), ''), '') = '' then raise exception 'kategori wajib diisi'; end if;
  if k not in ('baju','celana','baju+celana','sepatu','aksesoris') then raise exception 'komponen tidak dikenal'; end if;
  if p_beli is null or p_jual is null or p_beli < 0 or p_jual < 0 then raise exception 'harga beli dan harga jual wajib diisi (tidak boleh negatif)'; end if;
  if p_no is null then
    if exists (select 1 from public.harga_seragam h where h.nama = n) then raise exception 'seragam dengan nama itu sudah ada'; end if;
    insert into public.harga_seragam (no, kategori, nama, harga_beli, harga_jual, komponen, diperbarui)
      values ((select coalesce(max(no), 0) + 1 from public.harga_seragam), trim(p_kategori), n, p_beli, p_jual, k, now()) returning no into rid;
  else
    if exists (select 1 from public.harga_seragam h where h.nama = n and h.no <> p_no) then raise exception 'seragam dengan nama itu sudah ada'; end if;
    update public.harga_seragam set kategori = trim(p_kategori), nama = n, harga_beli = p_beli, harga_jual = p_jual, komponen = k, diperbarui = now() where no = p_no returning no into rid;
    if rid is null then raise exception 'seragam tidak ditemukan'; end if;
  end if;
  return rid;
end $f$;
revoke all on function public.admin_simpan_harga_seragam(text,int,text,text,int,int,text) from public; grant execute on function public.admin_simpan_harga_seragam(text,int,text,text,int,int,text) to anon, authenticated;
