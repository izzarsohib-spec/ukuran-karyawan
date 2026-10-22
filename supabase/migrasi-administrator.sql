-- Halaman Administrator: kelola data acuan (anggaran/anggota seragam, harga seragam, lokasi & harga peralatan, karyawan) + log perubahan.
-- Semua fungsi tulis & baca data pribadi memakai _wajib_kode() (= wajib login admin, lihat migrasi-login-admin-alih.sql).
-- Prinsip: yang sudah punya riwayat tidak dihapus (fungsi hapus menolaknya); karyawan keluar ditandai tidak aktif, bukan dihapus.

-- ================= karyawan masuk/keluar =================
alter table public.ukuran_pekerja add column if not exists aktif boolean not null default true;
alter table public.ukuran_pekerja add column if not exists keluar_pada date;

-- yang tidak aktif tidak dihitung dalam progres pengisian, tidak muncul di daftar ukuran publik, ploting, dan nama
create or replace view public.progres_pengisian as
 select a.client, a.lokasi_form, a.bagian_kerja, a.jumlah_anggota as target, (count(u.id))::integer as sudah_isi
 from public.acuan_rekap a
 left join public.ukuran_pekerja u on u.lokasi = a.lokasi_form and u.bagian_kerja = a.bagian_kerja and u.aktif
 group by a.client, a.lokasi_form, a.bagian_kerja, a.jumlah_anggota;

create or replace view public.ukuran_publik as
 select id, waktu, lokasi, bagian_kerja, ukuran_baju, ukuran_celana, ukuran_sepatu from public.ukuran_pekerja where aktif;

create or replace function public.daftar_nama(kode text)
 returns table(id bigint, waktu timestamptz, lokasi text, bagian_kerja text, nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language sql security definer set search_path to 'public','extensions' as $f$
  select u.id, u.waktu, u.lokasi, u.bagian_kerja, u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu
  from public.ukuran_pekerja u where public._adalah_admin() and u.aktif order by u.lokasi, u.id $f$;

create or replace function public.daftar_ukuran(kode text, p_lokasi text, p_bagian text)
 returns table(nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu
    from public.ukuran_pekerja u where u.lokasi = p_lokasi and u.bagian_kerja = p_bagian and u.aktif order by u.nama;
end $f$;

-- ================= log perubahan =================
create table if not exists public.log_perubahan (
  id bigint generated always as identity primary key,
  waktu timestamptz not null default now(),
  pengguna text not null,
  tabel text not null,
  aksi text not null check (aksi in ('insert','update','delete')),
  kunci text,
  sebelum jsonb,
  sesudah jsonb
);
create index if not exists log_perubahan_waktu on public.log_perubahan (waktu desc);
alter table public.log_perubahan enable row level security;
revoke all on table public.log_perubahan from anon, authenticated;

-- dicatat bila pelakunya admin yang login. Untuk ukuran_pekerja juga perubahan dari sistem (Google Form/sheet) supaya revisi ukuran
-- oleh karyawan punya riwayat. Perubahan yang hanya mengganti kolom `diperbarui` tidak dicatat.
create or replace function public._catat_log() returns trigger
 language plpgsql security definer set search_path to 'public' as $f$
declare em text := nullif(auth.jwt() ->> 'email', ''); b jsonb; s jsonb;
begin
  b := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  s := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  if tg_op = 'UPDATE' and (b - 'diperbarui') = (s - 'diperbarui') then return new; end if;
  if em is null and tg_table_name <> 'ukuran_pekerja' then return coalesce(new, old); end if;
  insert into public.log_perubahan (pengguna, tabel, aksi, kunci, sebelum, sesudah)
    values (coalesce(em, 'sistem (Google Form / sheet)'), tg_table_name, lower(tg_op), coalesce(coalesce(s, b) ->> 'id', coalesce(s, b) ->> 'no'), b, s);
  return coalesce(new, old);
end $f$;
revoke all on function public._catat_log() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['acuan_rekap','harga_seragam','peralatan_lokasi','peralatan_item','ukuran_pekerja'] loop
    execute format('drop trigger if exists log_perubahan on public.%I', t);
    execute format('create trigger log_perubahan after insert or update or delete on public.%I for each row execute function public._catat_log()', t);
  end loop;
end $$;

-- ================= fungsi baca =================
create or replace function public.admin_daftar_acuan()
 returns table(id bigint, client text, lokasi_form text, bagian_kerja text, jumlah_anggota int, anggaran bigint, masa_kontrak int, anggaran_per_orang numeric, karyawan int, riwayat int)
 language sql security definer set search_path to 'public' as $f$
  select a.id, a.client, a.lokasi_form, a.bagian_kerja, a.jumlah_anggota, a.anggaran, a.masa_kontrak, a.anggaran_per_orang,
    (select count(*)::int from public.ukuran_pekerja u where u.lokasi = a.lokasi_form and u.bagian_kerja = a.bagian_kerja and u.aktif),
    (select count(*)::int from public.permintaan p where p.lokasi_form = a.lokasi_form and p.bagian_kerja = a.bagian_kerja)
  from public.acuan_rekap a order by a.client, a.bagian_kerja $f$;
revoke all on function public.admin_daftar_acuan() from public; grant execute on function public.admin_daftar_acuan() to anon, authenticated;

create or replace function public.admin_daftar_harga_seragam()
 returns table(no int, kategori text, nama text, harga_beli int, harga_jual int, dipakai int)
 language sql security definer set search_path to 'public' as $f$
  select h.no, h.kategori, h.nama, h.harga_beli, h.harga_jual,
    (select count(*)::int from public.permintaan p, jsonb_array_elements(p.items) e where (e ->> 'no') ~ '^\d+$' and (e ->> 'no')::int = h.no)
    + (select count(*)::int from public.stok_gerak s where s.item_no = h.no)
  from public.harga_seragam h order by h.no $f$;
revoke all on function public.admin_daftar_harga_seragam() from public; grant execute on function public.admin_daftar_harga_seragam() to anon, authenticated;

create or replace function public.admin_daftar_karyawan(kode text)
 returns table(id bigint, lokasi text, bagian_kerja text, nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text, aktif boolean, keluar_pada date, diperbarui timestamptz)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select u.id, u.lokasi, u.bagian_kerja, u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu, u.aktif, u.keluar_pada, u.diperbarui
    from public.ukuran_pekerja u order by u.lokasi, u.bagian_kerja, u.nama;
end $f$;
revoke all on function public.admin_daftar_karyawan(text) from public; grant execute on function public.admin_daftar_karyawan(text) to anon, authenticated;

create or replace function public.admin_log(kode text, p_tabel text default null, p_kunci text default null, p_batas int default 300)
 returns table(id bigint, waktu timestamptz, pengguna text, tabel text, aksi text, kunci text, sebelum jsonb, sesudah jsonb)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select l.id, l.waktu, l.pengguna, l.tabel, l.aksi, l.kunci, l.sebelum, l.sesudah from public.log_perubahan l
    where (p_tabel is null or l.tabel = p_tabel) and (p_kunci is null or l.kunci = p_kunci) order by l.id desc limit least(greatest(p_batas, 1), 1000);
end $f$;
revoke all on function public.admin_log(text,text,text,int) from public; grant execute on function public.admin_log(text,text,text,int) to anon, authenticated;

create or replace function public.admin_daftar_pengguna(kode text)
 returns table(email text, peran text, aktif boolean, dibuat timestamptz)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select a.email, a.peran, a.aktif, a.dibuat from public.admin_pengguna a order by a.dibuat;
end $f$;
revoke all on function public.admin_daftar_pengguna(text) from public; grant execute on function public.admin_daftar_pengguna(text) to anon, authenticated;

-- ================= fungsi tulis: anggaran & anggota seragam (acuan_rekap) =================
-- Baru: client + lokasi + bagian wajib (pasangan lokasi+bagian harus unik). Ubah: hanya angka dan nama client; nama lokasi/bagian dikunci
-- karena karyawan, permintaan, dan tagihan mengacu ke nama itu.
create or replace function public.admin_simpan_acuan(kode text, p_id bigint, p_client text, p_lokasi text, p_bagian text, p_anggota int, p_anggaran bigint, p_masa int, p_per_orang numeric) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare rid bigint; lok text := upper(regexp_replace(trim(coalesce(p_lokasi,'')), '\s+', ' ', 'g')); bag text := upper(regexp_replace(trim(coalesce(p_bagian,'')), '\s+', ' ', 'g'));
        per numeric;
begin
  perform public._wajib_kode(kode);
  if coalesce(p_anggota, -1) < 0 then raise exception 'jumlah anggota wajib diisi (0 atau lebih)'; end if;
  if coalesce(p_anggaran, -1) < 0 then raise exception 'anggaran wajib diisi (0 atau lebih)'; end if;
  if coalesce(p_masa, 0) < 1 or p_masa > 60 then raise exception 'masa kontrak harus 1 sampai 60 bulan'; end if;
  per := coalesce(p_per_orang, case when p_anggota > 0 then p_anggaran::numeric / p_anggota / p_masa end);
  if p_id is null then
    if lok = '' or bag = '' then raise exception 'lokasi dan bagian kerja wajib diisi'; end if;
    if exists (select 1 from public.acuan_rekap a where a.lokasi_form = lok and a.bagian_kerja = bag) then raise exception 'lokasi dan bagian kerja itu sudah ada'; end if;
    insert into public.acuan_rekap (client, bagian_kerja, jumlah_anggota, anggaran, lokasi_form, masa_kontrak, anggaran_per_orang)
      values (coalesce(nullif(upper(trim(p_client)), ''), lok), bag, p_anggota, p_anggaran, lok, p_masa, per) returning id into rid;
  else
    update public.acuan_rekap set client = coalesce(nullif(upper(trim(p_client)), ''), client), jumlah_anggota = p_anggota, anggaran = p_anggaran,
      masa_kontrak = p_masa, anggaran_per_orang = per where id = p_id returning id into rid;
    if rid is null then raise exception 'data tidak ditemukan'; end if;
  end if;
  return rid;
end $f$;
revoke all on function public.admin_simpan_acuan(text,bigint,text,text,text,int,bigint,int,numeric) from public; grant execute on function public.admin_simpan_acuan(text,bigint,text,text,text,int,bigint,int,numeric) to anon, authenticated;

create or replace function public.admin_hapus_acuan(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
declare a public.acuan_rekap%rowtype; n int;
begin
  perform public._wajib_kode(kode);
  select * into a from public.acuan_rekap where id = p_id; if not found then raise exception 'data tidak ditemukan'; end if;
  select count(*) into n from public.ukuran_pekerja u where u.lokasi = a.lokasi_form and u.bagian_kerja = a.bagian_kerja;
  if n > 0 then raise exception 'tidak bisa dihapus: masih ada % karyawan di lokasi dan bagian ini (pindahkan atau hapus karyawannya dulu)', n; end if;
  if exists (select 1 from public.permintaan p where p.lokasi_form = a.lokasi_form and p.bagian_kerja = a.bagian_kerja)
     or exists (select 1 from public.tagihan t where t.lokasi_form = a.lokasi_form and t.bagian_kerja = a.bagian_kerja)
     or exists (select 1 from public.pengiriman g where g.lokasi_form = a.lokasi_form and g.bagian_kerja = a.bagian_kerja)
     or exists (select 1 from public.ploting g where g.lokasi_form = a.lokasi_form and g.bagian_kerja = a.bagian_kerja) then
    raise exception 'tidak bisa dihapus: sudah punya riwayat permintaan, ploting, pengiriman, atau tagihan';
  end if;
  delete from public.acuan_rekap where id = p_id;
end $f$;
revoke all on function public.admin_hapus_acuan(text,bigint) from public; grant execute on function public.admin_hapus_acuan(text,bigint) to anon, authenticated;

-- ================= fungsi tulis: jenis & harga seragam (harga_seragam) =================
create or replace function public.admin_simpan_harga_seragam(kode text, p_no int, p_kategori text, p_nama text, p_beli int, p_jual int) returns int
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); rid int;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama seragam wajib diisi'; end if;
  if coalesce(nullif(trim(p_kategori), ''), '') = '' then raise exception 'kategori wajib diisi'; end if;
  if p_beli is null or p_jual is null or p_beli < 0 or p_jual < 0 then raise exception 'harga beli dan harga jual wajib diisi (tidak boleh negatif)'; end if;
  if p_no is null then
    if exists (select 1 from public.harga_seragam h where h.nama = n) then raise exception 'seragam dengan nama itu sudah ada'; end if;
    insert into public.harga_seragam (no, kategori, nama, harga_beli, harga_jual, diperbarui)
      values ((select coalesce(max(no), 0) + 1 from public.harga_seragam), trim(p_kategori), n, p_beli, p_jual, now()) returning no into rid;
  else
    if exists (select 1 from public.harga_seragam h where h.nama = n and h.no <> p_no) then raise exception 'seragam dengan nama itu sudah ada'; end if;
    update public.harga_seragam set kategori = trim(p_kategori), nama = n, harga_beli = p_beli, harga_jual = p_jual, diperbarui = now() where no = p_no returning no into rid;
    if rid is null then raise exception 'seragam tidak ditemukan'; end if;
  end if;
  return rid;
end $f$;
revoke all on function public.admin_simpan_harga_seragam(text,int,text,text,int,int) from public; grant execute on function public.admin_simpan_harga_seragam(text,int,text,text,int,int) to anon, authenticated;

create or replace function public.admin_hapus_harga_seragam(kode text, p_no int) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.harga_seragam where no = p_no) then raise exception 'seragam tidak ditemukan'; end if;
  if exists (select 1 from public.permintaan p, jsonb_array_elements(p.items) e where (e ->> 'no') ~ '^\d+$' and (e ->> 'no')::int = p_no)
     or exists (select 1 from public.stok_gerak s where s.item_no = p_no)
     or exists (select 1 from public.tagihan_item t where t.item_no = p_no)
     or exists (select 1 from public.ploting g where g.item_no = p_no)
     or exists (select 1 from public.opname_item o where o.item_no = p_no) then
    raise exception 'tidak bisa dihapus: seragam ini sudah dipakai di permintaan, stok, ploting, atau tagihan';
  end if;
  delete from public.harga_seragam where no = p_no;
end $f$;
revoke all on function public.admin_hapus_harga_seragam(text,int) from public; grant execute on function public.admin_hapus_harga_seragam(text,int) to anon, authenticated;

-- ================= fungsi tulis: hapus lokasi/peralatan (simpan/ubah sudah ada di migrasi-peralatan-kelola.sql) =================
create or replace function public.admin_hapus_lokasi_peralatan(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.peralatan_lokasi where id = p_id) then raise exception 'lokasi tidak ditemukan'; end if;
  if exists (select 1 from public.peralatan_permintaan where lokasi_id = p_id) then raise exception 'tidak bisa dihapus: lokasi ini sudah punya riwayat permintaan (nonaktifkan saja)'; end if;
  delete from public.peralatan_lokasi where id = p_id;
end $f$;
revoke all on function public.admin_hapus_lokasi_peralatan(text,bigint) from public; grant execute on function public.admin_hapus_lokasi_peralatan(text,bigint) to anon, authenticated;

create or replace function public.admin_hapus_item_peralatan(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.peralatan_item where id = p_id) then raise exception 'peralatan tidak ditemukan'; end if;
  if exists (select 1 from public.peralatan_permintaan_item where item_id = p_id) then raise exception 'tidak bisa dihapus: peralatan ini sudah dipakai di permintaan (nonaktifkan saja)'; end if;
  delete from public.peralatan_item where id = p_id;
end $f$;
revoke all on function public.admin_hapus_item_peralatan(text,bigint) from public; grant execute on function public.admin_hapus_item_peralatan(text,bigint) to anon, authenticated;

-- ================= fungsi tulis: karyawan =================
-- p_id kosong = karyawan baru (masuk). Lokasi + bagian harus ada di acuan supaya ikut terhitung di progres pengisian.
create or replace function public.admin_simpan_karyawan(kode text, p_id bigint, p_lokasi text, p_bagian text, p_nama text, p_baju text, p_celana text, p_sepatu text) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare rid bigint; nm text := regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g');
begin
  perform public._wajib_kode(kode);
  if nm = '' then raise exception 'nama karyawan wajib diisi'; end if;
  if not exists (select 1 from public.acuan_rekap a where a.lokasi_form = p_lokasi and a.bagian_kerja = p_bagian) then raise exception 'lokasi dan bagian kerja itu belum ada di anggaran seragam (tambahkan dulu)'; end if;
  if p_id is null then
    insert into public.ukuran_pekerja (kunci, waktu, lokasi, bagian_kerja, nama, ukuran_baju, ukuran_celana, ukuran_sepatu, sumber_tab, aktif)
      values ('ADMIN|' || gen_random_uuid()::text, now(), p_lokasi, p_bagian, nm, nullif(trim(p_baju), ''), nullif(trim(p_celana), ''), nullif(trim(p_sepatu), ''), 'ADMIN', true) returning id into rid;
  else
    update public.ukuran_pekerja set lokasi = p_lokasi, bagian_kerja = p_bagian, nama = nm, ukuran_baju = nullif(trim(p_baju), ''), ukuran_celana = nullif(trim(p_celana), ''),
      ukuran_sepatu = nullif(trim(p_sepatu), ''), diperbarui = now() where id = p_id returning id into rid;
    if rid is null then raise exception 'karyawan tidak ditemukan'; end if;
  end if;
  return rid;
end $f$;
revoke all on function public.admin_simpan_karyawan(text,bigint,text,text,text,text,text,text) from public; grant execute on function public.admin_simpan_karyawan(text,bigint,text,text,text,text,text,text) to anon, authenticated;

-- karyawan keluar / aktif lagi (tidak menghapus riwayat)
create or replace function public.admin_status_karyawan(kode text, p_id bigint, p_aktif boolean, p_tanggal date default null) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  update public.ukuran_pekerja set aktif = p_aktif, keluar_pada = case when p_aktif then null else coalesce(p_tanggal, current_date) end, diperbarui = now() where id = p_id;
  if not found then raise exception 'karyawan tidak ditemukan'; end if;
end $f$;
revoke all on function public.admin_status_karyawan(text,bigint,boolean,date) from public; grant execute on function public.admin_status_karyawan(text,bigint,boolean,date) to anon, authenticated;

create or replace function public.admin_hapus_karyawan(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
declare u public.ukuran_pekerja%rowtype;
begin
  perform public._wajib_kode(kode);
  select * into u from public.ukuran_pekerja where id = p_id; if not found then raise exception 'karyawan tidak ditemukan'; end if;
  if exists (select 1 from public.ploting g where g.lokasi_form = u.lokasi and g.bagian_kerja = u.bagian_kerja and g.nama = u.nama) then
    raise exception 'tidak bisa dihapus: karyawan ini sudah tercatat di ploting seragam (tandai keluar saja)';
  end if;
  delete from public.ukuran_pekerja where id = p_id;
end $f$;
revoke all on function public.admin_hapus_karyawan(text,bigint) from public; grant execute on function public.admin_hapus_karyawan(text,bigint) to anon, authenticated;
