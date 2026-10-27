-- Koreksi admin bersifat permanen: baris ukuran_pekerja yang pernah diedit admin DIKUNCI, sehingga sinkronisasi Apps Script
-- (upsert menurut kunci, memakai service_role) tidak lagi menimpanya dengan isi spreadsheet Form.
-- Baris asal Form yang "dihapus" admin ditandai dibatalkan (bukan dihapus), supaya tidak muncul lagi pada sinkronisasi berikutnya.

alter table public.ukuran_pekerja add column if not exists dikunci boolean not null default false;
alter table public.ukuran_pekerja add column if not exists dibatalkan boolean not null default false;

-- Sinkronisasi masuk lewat PostgREST sebagai service_role; fungsi admin berjalan sebagai pemilik fungsi (security definer), jadi tidak terkena.
create or replace function public._lindungi_dikunci() returns trigger
 language plpgsql as $f$
begin
  if old.dikunci and current_user = 'service_role' then return old; end if;
  return new;
end $f$;
revoke all on function public._lindungi_dikunci() from public, anon, authenticated;

drop trigger if exists lindungi_dikunci on public.ukuran_pekerja;
create trigger lindungi_dikunci before update on public.ukuran_pekerja for each row execute function public._lindungi_dikunci();

-- baris yang dibatalkan tidak dihitung dan tidak tampil
create or replace function public.admin_daftar_karyawan(kode text)
 returns table(id bigint, lokasi text, bagian_kerja text, nama text, ukuran_baju text, ukuran_celana text, ukuran_sepatu text, aktif boolean, keluar_pada date, diperbarui timestamptz)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select u.id, u.lokasi, u.bagian_kerja, u.nama, u.ukuran_baju, u.ukuran_celana, u.ukuran_sepatu, u.aktif, u.keluar_pada, u.diperbarui
    from public.ukuran_pekerja u where not u.dibatalkan order by u.lokasi, u.bagian_kerja, u.nama;
end $f$;

-- ubah lewat admin = kunci
create or replace function public.admin_simpan_karyawan(kode text, p_id bigint, p_lokasi text, p_bagian text, p_nama text, p_baju text, p_celana text, p_sepatu text) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare rid bigint; nm text := regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g');
begin
  perform public._wajib_kode(kode);
  if nm = '' then raise exception 'nama karyawan wajib diisi'; end if;
  if not exists (select 1 from public.acuan_rekap a where a.lokasi_form = p_lokasi and a.bagian_kerja = p_bagian) then raise exception 'lokasi dan bagian kerja itu belum ada di anggaran seragam (tambahkan dulu)'; end if;
  if p_id is null then
    insert into public.ukuran_pekerja (kunci, waktu, lokasi, bagian_kerja, nama, ukuran_baju, ukuran_celana, ukuran_sepatu, sumber_tab, aktif, dikunci)
      values ('ADMIN|' || gen_random_uuid()::text, now(), p_lokasi, p_bagian, nm, nullif(trim(p_baju), ''), nullif(trim(p_celana), ''), nullif(trim(p_sepatu), ''), 'ADMIN', true, true) returning id into rid;
  else
    update public.ukuran_pekerja set lokasi = p_lokasi, bagian_kerja = p_bagian, nama = nm, ukuran_baju = nullif(trim(p_baju), ''), ukuran_celana = nullif(trim(p_celana), ''),
      ukuran_sepatu = nullif(trim(p_sepatu), ''), dikunci = true, diperbarui = now() where id = p_id returning id into rid;
    if rid is null then raise exception 'karyawan tidak ditemukan'; end if;
  end if;
  return rid;
end $f$;

-- hapus: baris admin dihapus sungguhan; baris asal Form hanya ditandai dibatalkan dan dikunci
create or replace function public.admin_hapus_karyawan(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
declare u public.ukuran_pekerja%rowtype;
begin
  perform public._wajib_kode(kode);
  select * into u from public.ukuran_pekerja where id = p_id; if not found then raise exception 'karyawan tidak ditemukan'; end if;
  if exists (select 1 from public.ploting g where g.lokasi_form = u.lokasi and g.bagian_kerja = u.bagian_kerja and g.nama = u.nama) then
    raise exception 'tidak bisa dihapus: karyawan ini sudah tercatat di ploting seragam (tandai keluar saja)';
  end if;
  if u.sumber_tab = 'ADMIN' then delete from public.ukuran_pekerja where id = p_id;
  else update public.ukuran_pekerja set dibatalkan = true, aktif = false, dikunci = true, diperbarui = now() where id = p_id; end if;
end $f$;
