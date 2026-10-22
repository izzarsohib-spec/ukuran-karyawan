-- Cabang kantor (pusat Semarang, cabang Magelang dan Kalimantan), PIC lapangan per cabang, dan penugasan PIC per lokasi.
-- Lokasi dikenali lewat NAMA (acuan_rekap.lokasi_form untuk Seragam, peralatan_lokasi.nama untuk Peralatan) supaya satu tabel melayani kedua modul.
-- Dibaca dan diubah lewat halaman Administrator; data PIC (nama, telepon) hanya untuk admin yang login.

create table if not exists public.cabang (
  id bigint generated always as identity primary key,
  nama text not null unique,
  jenis text not null default 'cabang' check (jenis in ('pusat','cabang')),
  kota text,
  aktif boolean not null default true
);
create table if not exists public.pic_lapangan (
  id bigint generated always as identity primary key,
  nama text not null,
  cabang_id bigint not null references public.cabang(id),
  telepon text,
  aktif boolean not null default true,
  catatan text,
  unique (nama, cabang_id)
);
create table if not exists public.lokasi_penugasan (
  lokasi text primary key,
  cabang_id bigint references public.cabang(id),
  pic_id bigint references public.pic_lapangan(id),
  diperbarui timestamptz not null default now()
);
alter table public.cabang enable row level security;
alter table public.pic_lapangan enable row level security;
alter table public.lokasi_penugasan enable row level security;
revoke all on table public.cabang, public.pic_lapangan, public.lokasi_penugasan from anon, authenticated;

-- log perubahan: kunci juga dikenali dari kolom `lokasi`
create or replace function public._catat_log() returns trigger
 language plpgsql security definer set search_path to 'public' as $f$
declare em text := nullif(auth.jwt() ->> 'email', ''); b jsonb; s jsonb;
begin
  b := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  s := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  if tg_op = 'UPDATE' and (b - 'diperbarui') = (s - 'diperbarui') then return new; end if;
  if em is null and tg_table_name <> 'ukuran_pekerja' then return coalesce(new, old); end if;
  insert into public.log_perubahan (pengguna, tabel, aksi, kunci, sebelum, sesudah)
    values (coalesce(em, 'sistem (Google Form / sheet)'), tg_table_name, lower(tg_op), coalesce(s, b) ->> coalesce(case when coalesce(s, b) ? 'id' then 'id' end, case when coalesce(s, b) ? 'no' then 'no' end, 'lokasi'), b, s);
  return coalesce(new, old);
end $f$;
revoke all on function public._catat_log() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['cabang','pic_lapangan','lokasi_penugasan'] loop
    execute format('drop trigger if exists log_perubahan on public.%I', t);
    execute format('create trigger log_perubahan after insert or update or delete on public.%I for each row execute function public._catat_log()', t);
  end loop;
end $$;

-- ================= baca =================
create or replace function public.admin_daftar_cabang()
 returns table(id bigint, nama text, jenis text, kota text, aktif boolean, jumlah_pic int, jumlah_lokasi int)
 language sql security definer set search_path to 'public' as $f$
  select c.id, c.nama, c.jenis, c.kota, c.aktif,
    (select count(*)::int from public.pic_lapangan p where p.cabang_id = c.id and p.aktif),
    (select count(*)::int from public.lokasi_penugasan l where l.cabang_id = c.id)
  from public.cabang c order by (c.jenis = 'pusat') desc, c.nama $f$;
revoke all on function public.admin_daftar_cabang() from public; grant execute on function public.admin_daftar_cabang() to anon, authenticated;

create or replace function public.admin_daftar_pic(kode text)
 returns table(id bigint, nama text, cabang_id bigint, cabang text, telepon text, aktif boolean, catatan text, jumlah_lokasi int)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select p.id, p.nama, p.cabang_id, c.nama, p.telepon, p.aktif, p.catatan,
    (select count(*)::int from public.lokasi_penugasan l where l.pic_id = p.id)
    from public.pic_lapangan p join public.cabang c on c.id = p.cabang_id order by c.nama, p.nama;
end $f$;
revoke all on function public.admin_daftar_pic(text) from public; grant execute on function public.admin_daftar_pic(text) to anon, authenticated;

-- semua nama lokasi dari kedua modul (Seragam: anggaran; Peralatan: lokasi) beserta penugasannya
create or replace function public.admin_daftar_penugasan(kode text)
 returns table(lokasi text, sumber text, anggota int, bagian int, cabang_id bigint, cabang text, pic_id bigint, pic text, diperbarui timestamptz)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query
   with n as (
     select a.lokasi_form as nama, sum(a.jumlah_anggota)::int as anggota, count(*)::int as bagian, 'seragam'::text as src from public.acuan_rekap a group by a.lokasi_form
     union all select upper(l.nama), coalesce(l.anggota, 0), 1, 'peralatan' from public.peralatan_lokasi l where l.aktif),
   g as (select n.nama, max(n.anggota) as anggota, sum(n.bagian)::int as bagian,
           case when count(distinct n.src) = 2 then 'keduanya' else min(n.src) end as sumber from n group by n.nama)
   select g.nama, g.sumber, g.anggota, g.bagian, p.cabang_id, c.nama, p.pic_id, k.nama, p.diperbarui
   from g left join public.lokasi_penugasan p on p.lokasi = g.nama left join public.cabang c on c.id = p.cabang_id left join public.pic_lapangan k on k.id = p.pic_id
   order by g.nama;
end $f$;
revoke all on function public.admin_daftar_penugasan(text) from public; grant execute on function public.admin_daftar_penugasan(text) to anon, authenticated;

-- ================= tulis =================
create or replace function public.admin_simpan_cabang(kode text, p_id bigint, p_nama text, p_jenis text, p_kota text, p_aktif boolean) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama cabang wajib diisi'; end if;
  if coalesce(p_jenis, 'cabang') not in ('pusat','cabang') then raise exception 'jenis harus pusat atau cabang'; end if;
  if p_id is null then
    insert into public.cabang (nama, jenis, kota, aktif) values (n, coalesce(p_jenis, 'cabang'), nullif(trim(p_kota), ''), true) returning id into rid;
  else
    update public.cabang set nama = n, jenis = coalesce(p_jenis, jenis), kota = nullif(trim(p_kota), ''), aktif = coalesce(p_aktif, aktif) where id = p_id returning id into rid;
    if rid is null then raise exception 'cabang tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'cabang dengan nama itu sudah ada';
end $f$;
revoke all on function public.admin_simpan_cabang(text,bigint,text,text,text,boolean) from public; grant execute on function public.admin_simpan_cabang(text,bigint,text,text,text,boolean) to anon, authenticated;

create or replace function public.admin_hapus_cabang(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.cabang where id = p_id) then raise exception 'cabang tidak ditemukan'; end if;
  if exists (select 1 from public.pic_lapangan where cabang_id = p_id) or exists (select 1 from public.lokasi_penugasan where cabang_id = p_id) then
    raise exception 'tidak bisa dihapus: cabang ini masih punya PIC atau lokasi (nonaktifkan saja)'; end if;
  delete from public.cabang where id = p_id;
end $f$;
revoke all on function public.admin_hapus_cabang(text,bigint) from public; grant execute on function public.admin_hapus_cabang(text,bigint) to anon, authenticated;

create or replace function public.admin_simpan_pic(kode text, p_id bigint, p_nama text, p_cabang bigint, p_telepon text, p_aktif boolean, p_catatan text) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g'); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama PIC wajib diisi'; end if;
  if not exists (select 1 from public.cabang where id = p_cabang) then raise exception 'cabang wajib dipilih'; end if;
  if p_id is null then
    insert into public.pic_lapangan (nama, cabang_id, telepon, aktif, catatan) values (n, p_cabang, nullif(trim(p_telepon), ''), true, nullif(trim(p_catatan), '')) returning id into rid;
  else
    -- PIC yang dipindah cabang tidak boleh masih memegang lokasi di cabang lama
    if exists (select 1 from public.pic_lapangan x where x.id = p_id and x.cabang_id <> p_cabang) and exists (select 1 from public.lokasi_penugasan l where l.pic_id = p_id) then
      raise exception 'PIC ini masih memegang lokasi; pindahkan lokasinya ke PIC lain dulu sebelum mengganti cabang'; end if;
    update public.pic_lapangan set nama = n, cabang_id = p_cabang, telepon = nullif(trim(p_telepon), ''), aktif = coalesce(p_aktif, aktif), catatan = nullif(trim(p_catatan), '') where id = p_id returning id into rid;
    if rid is null then raise exception 'PIC tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'PIC dengan nama itu sudah ada di cabang tersebut';
end $f$;
revoke all on function public.admin_simpan_pic(text,bigint,text,bigint,text,boolean,text) from public; grant execute on function public.admin_simpan_pic(text,bigint,text,bigint,text,boolean,text) to anon, authenticated;

create or replace function public.admin_hapus_pic(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.pic_lapangan where id = p_id) then raise exception 'PIC tidak ditemukan'; end if;
  if exists (select 1 from public.lokasi_penugasan where pic_id = p_id) then raise exception 'tidak bisa dihapus: PIC ini masih memegang lokasi (pindahkan lokasinya dulu, atau nonaktifkan saja)'; end if;
  delete from public.pic_lapangan where id = p_id;
end $f$;
revoke all on function public.admin_hapus_pic(text,bigint) from public; grant execute on function public.admin_hapus_pic(text,bigint) to anon, authenticated;

-- tetapkan cabang + PIC untuk satu atau banyak lokasi sekaligus (p_pic boleh kosong = belum ada PIC). Mengembalikan jumlah lokasi yang diubah.
create or replace function public.admin_simpan_penugasan(kode text, p_lokasi text[], p_cabang bigint, p_pic bigint) returns int
 language plpgsql security definer set search_path to 'public' as $f$
declare n int; ada int;
begin
  perform public._wajib_kode(kode);
  if coalesce(array_length(p_lokasi, 1), 0) = 0 then raise exception 'pilih minimal satu lokasi'; end if;
  if array_length(p_lokasi, 1) > 500 then raise exception 'terlalu banyak lokasi sekaligus (maksimal 500)'; end if;
  if p_cabang is not null and not exists (select 1 from public.cabang where id = p_cabang and aktif) then raise exception 'cabang tidak ditemukan atau nonaktif'; end if;
  if p_pic is not null then
    if p_cabang is null then raise exception 'pilih cabang dulu sebelum memilih PIC'; end if;
    if not exists (select 1 from public.pic_lapangan where id = p_pic and cabang_id = p_cabang and aktif) then raise exception 'PIC itu bukan PIC aktif di cabang yang dipilih'; end if;
  end if;
  select count(*) into ada from public.admin_daftar_penugasan(kode) d where d.lokasi = any (p_lokasi);
  if ada <> (select count(distinct x) from unnest(p_lokasi) x) then raise exception 'ada nama lokasi yang tidak dikenal'; end if;
  insert into public.lokasi_penugasan (lokasi, cabang_id, pic_id, diperbarui)
    select distinct x, p_cabang, p_pic, now() from unnest(p_lokasi) x
    on conflict (lokasi) do update set cabang_id = excluded.cabang_id, pic_id = excluded.pic_id, diperbarui = now();
  get diagnostics n = row_count;
  return n;
end $f$;
revoke all on function public.admin_simpan_penugasan(text,text[],bigint,bigint) from public; grant execute on function public.admin_simpan_penugasan(text,text[],bigint,bigint) to anon, authenticated;
