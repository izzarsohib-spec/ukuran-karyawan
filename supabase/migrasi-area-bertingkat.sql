-- Area bertingkat: Semarang punya sub-area (Barat, Timur, Selatan, Kota). Filter area di web mencakup sub-areanya.
alter table public.cabang add column if not exists induk_id bigint references public.cabang(id);

drop function if exists public.admin_daftar_cabang();
create function public.admin_daftar_cabang()
 returns table(id bigint, nama text, jenis text, kota text, aktif boolean, jumlah_pic int, jumlah_lokasi int, induk_id bigint, induk text)
 language sql security definer set search_path to 'public' as $f$
  select c.id, c.nama, c.jenis, c.kota, c.aktif,
    (select count(*)::int from public.pic_lapangan p where p.cabang_id = c.id and p.aktif),
    (select count(*)::int from public.lokasi_penugasan l where l.cabang_id = c.id),
    c.induk_id, (select i.nama from public.cabang i where i.id = c.induk_id)
  from public.cabang c order by coalesce(c.induk_id, c.id), (c.induk_id is not null), c.nama $f$;
revoke all on function public.admin_daftar_cabang() from public; grant execute on function public.admin_daftar_cabang() to anon, authenticated;

drop function if exists public.admin_simpan_cabang(text,bigint,text,text,text,boolean);
create function public.admin_simpan_cabang(kode text, p_id bigint, p_nama text, p_jenis text, p_kota text, p_aktif boolean, p_induk bigint default null) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama cabang wajib diisi'; end if;
  if coalesce(p_jenis, 'cabang') not in ('pusat','cabang') then raise exception 'jenis harus pusat atau cabang'; end if;
  if p_induk is not null then
    if p_induk = p_id then raise exception 'cabang tidak bisa menjadi induk dirinya sendiri'; end if;
    if exists (select 1 from public.cabang where id = p_induk and induk_id is not null) then raise exception 'induk harus berupa area utama (maksimal dua tingkat)'; end if;
    if not exists (select 1 from public.cabang where id = p_induk) then raise exception 'induk tidak ditemukan'; end if;
    if p_id is not null and exists (select 1 from public.cabang where induk_id = p_id) then raise exception 'cabang ini punya sub-area, tidak bisa dijadikan sub-area'; end if;
  end if;
  if p_id is null then
    insert into public.cabang (nama, jenis, kota, aktif, induk_id) values (n, coalesce(p_jenis, 'cabang'), nullif(trim(p_kota), ''), true, p_induk) returning id into rid;
  else
    update public.cabang set nama = n, jenis = coalesce(p_jenis, jenis), kota = nullif(trim(p_kota), ''), aktif = coalesce(p_aktif, aktif), induk_id = p_induk where id = p_id returning id into rid;
    if rid is null then raise exception 'cabang tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'cabang dengan nama itu sudah ada';
end $f$;
revoke all on function public.admin_simpan_cabang(text,bigint,text,text,text,boolean,bigint) from public; grant execute on function public.admin_simpan_cabang(text,bigint,text,text,text,boolean,bigint) to anon, authenticated;

create or replace function public.daftar_penugasan_publik() returns jsonb
 language sql stable security definer set search_path to 'public' as $f$
  select jsonb_build_object(
    'cabang', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.nama, 'induk', c.induk_id) order by (c.jenis = 'pusat') desc, coalesce(c.induk_id, c.id), (c.induk_id is not null), c.nama), '[]'::jsonb) from public.cabang c where c.aktif),
    'pic',    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nama', p.nama, 'cabang_id', p.cabang_id) order by p.nama), '[]'::jsonb) from public.pic_lapangan p where p.aktif),
    'lokasi', (select coalesce(jsonb_agg(jsonb_build_object('l', upper(l.lokasi), 'c', l.cabang_id, 'p', l.pic_id)), '[]'::jsonb) from public.lokasi_penugasan l)) $f$;

-- ===== data pembagian area (ditetapkan user 23 Okt 2026) =====
update public.cabang set nama = 'SEMARANG' where id = 1 and jenis = 'pusat';
insert into public.cabang (nama, jenis, kota, aktif, induk_id)
  select v.nama, 'cabang', 'Semarang', true, (select id from public.cabang where jenis = 'pusat' limit 1)
  from (values ('SEMARANG BARAT'), ('SEMARANG TIMUR'), ('SEMARANG SELATAN'), ('SEMARANG KOTA')) v(nama)
  on conflict do nothing;
with peta(pic, area) as (values ('Indra','MAGELANG'),('Sukamto','MAGELANG'),('Purwito','MAGELANG'),('Sugi','MAGELANG'),('Ridwan','KALIMANTAN'),
  ('Asmono','SEMARANG BARAT'),('Rendy','SEMARANG TIMUR'),('Masudi','SEMARANG SELATAN'),('Ihsan','SEMARANG KOTA'),('Moelyono','SEMARANG KOTA'))
update public.pic_lapangan p set cabang_id = c.id from peta m join public.cabang c on c.nama = m.area where p.nama = m.pic;
-- lokasi mengikuti area PIC yang memegangnya
update public.lokasi_penugasan l set cabang_id = p.cabang_id from public.pic_lapangan p where p.id = l.pic_id and l.cabang_id is distinct from p.cabang_id;
