-- Kekurangan barang dari vendor + penagihan kepastian kirim + pengingat deadline lewat WhatsApp (n8n/WAHA).
-- Kekurangan = dipesan (permintaan yang disetujui kedua pimpinan, menurut ukuran dari pembagian per karyawan)
--              - diterima dari supplier (barang masuk yang bukan retur, dikurangi retur ke supplier) untuk item + jenis ukuran + ukuran yang sama.
-- Hanya baju, celana, dan sepatu (aksesoris dipesan online, bukan ke vendor). Permintaan lama tanpa pembagian per karyawan tidak punya ukuran, jadi tidak ikut.
-- Menambah tabel dan fungsi baru; tidak mengubah yang sudah ada.

-- ================= VENDOR =================
create table if not exists public.vendor (
  id bigint generated always as identity primary key,
  nama text not null unique,
  telepon text,
  aktif boolean not null default true,
  catatan text
);
insert into public.vendor (nama) values ('Wahyu Ardianto') on conflict (nama) do nothing;

-- satu putaran penagihan: dibuat saat vendor pertama kali ditagih, ditutup bila semua sudah diterima
create table if not exists public.tagih_vendor (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendor(id),
  dibuat timestamptz not null default now(),
  status text not null default 'menunggu_jawaban' check (status in ('menunggu_jawaban', 'dijanjikan', 'selesai')),
  janji_kirim date,
  tgl_janji_dicatat date,
  catatan text,
  jumlah_pengingat int not null default 0,
  terakhir_diingatkan timestamptz,
  pengingat_oto_untuk date,      -- tanggal janji yang sudah dibuatkan pengingat otomatis (supaya tidak terkirim ganda)
  selesai_pada timestamptz
);
create unique index if not exists tagih_vendor_aktif_uniq on public.tagih_vendor (vendor_id) where status <> 'selesai';
alter table public.vendor enable row level security;       revoke all on public.vendor from anon, authenticated;
alter table public.tagih_vendor enable row level security; revoke all on public.tagih_vendor from anon, authenticated;

-- ================= ADMINISTRATOR: DAFTAR & SIMPAN VENDOR =================
create or replace function public.admin_daftar_vendor(kode text)
 returns table(id bigint, nama text, telepon text, aktif boolean, catatan text, jumlah_tagih int)
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select v.id, v.nama, v.telepon, v.aktif, v.catatan, (select count(*)::int from public.tagih_vendor t where t.vendor_id = v.id) from public.vendor v order by v.nama;
end $f$;
revoke all on function public.admin_daftar_vendor(text) from public; grant execute on function public.admin_daftar_vendor(text) to anon, authenticated;

create or replace function public.admin_simpan_vendor(kode text, p_id bigint, p_nama text, p_telepon text, p_aktif boolean, p_catatan text) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare n text := regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g'); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama vendor wajib diisi'; end if;
  if p_id is null then
    insert into public.vendor (nama, telepon, aktif, catatan) values (n, nullif(trim(p_telepon), ''), true, nullif(trim(p_catatan), '')) returning id into rid;
  else
    update public.vendor set nama = n, telepon = nullif(trim(p_telepon), ''), aktif = coalesce(p_aktif, aktif), catatan = nullif(trim(p_catatan), '') where id = p_id returning id into rid;
    if rid is null then raise exception 'vendor tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'vendor dengan nama itu sudah ada';
end $f$;
revoke all on function public.admin_simpan_vendor(text,bigint,text,text,boolean,text) from public; grant execute on function public.admin_simpan_vendor(text,bigint,text,text,boolean,text) to anon, authenticated;

create or replace function public.admin_hapus_vendor(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if exists (select 1 from public.tagih_vendor where vendor_id = p_id) then raise exception 'tidak bisa dihapus: vendor ini sudah punya riwayat penagihan (nonaktifkan saja)'; end if;
  delete from public.vendor where id = p_id;
end $f$;
revoke all on function public.admin_hapus_vendor(text,bigint) from public; grant execute on function public.admin_hapus_vendor(text,bigint) to anon, authenticated;

-- ================= KEKURANGAN =================
-- dasar: tanpa pemeriksaan login; hanya untuk fungsi server (service_role). Mengembalikan baris per item + jenis ukuran + ukuran.
create or replace function public.kekurangan_vendor_dasar(p_vendor bigint)
 returns table(item_no int, item_nama text, kategori text, jenis text, ukuran text, dipesan bigint, diterima bigint)
 language sql stable security definer set search_path to 'public' as $f$
  with v as (select lower(btrim(nama)) as nm from public.vendor where id = p_vendor),
  pesan as (
    select g.item_no, max(g.item_nama) as item_nama, u.jenis, u.ukuran, sum(g.qty)::bigint as q
    from public.ploting g
    join public.permintaan p on p.id = g.permintaan_id
    cross join lateral (values ('baju', g.ukuran_baju), ('celana', g.ukuran_celana), ('sepatu', g.ukuran_sepatu)) as u(jenis, ukuran)
    where u.ukuran is not null
      and coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui'
    group by g.item_no, u.jenis, u.ukuran),
  terima as (
    select s.item_no, s.jenis_ukuran as jenis, s.ukuran, sum(case when s.jenis = 'masuk' then s.qty else -s.qty end)::bigint as q
    from public.stok_gerak s, v
    where lower(btrim(coalesce(s.supplier, ''))) = v.nm
      and ((s.jenis = 'masuk' and s.sumber is null) or (s.jenis = 'keluar' and s.sumber = 'retur'))
    group by s.item_no, s.jenis_ukuran, s.ukuran)
  select p.item_no, p.item_nama, h.kategori, p.jenis, p.ukuran, p.q, coalesce(t.q, 0)
  from pesan p join public.harga_seragam h on h.no = p.item_no
  left join terima t on t.item_no = p.item_no and t.jenis = p.jenis and t.ukuran = p.ukuran
  order by p.item_no, p.jenis, p.ukuran $f$;
revoke all on function public.kekurangan_vendor_dasar(bigint) from public, anon, authenticated;
grant execute on function public.kekurangan_vendor_dasar(bigint) to service_role;

create or replace function public.kekurangan_vendor(kode text, p_vendor bigint)
 returns table(item_no int, item_nama text, kategori text, jenis text, ukuran text, dipesan bigint, diterima bigint)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select * from public.kekurangan_vendor_dasar(p_vendor);
end $f$;
revoke all on function public.kekurangan_vendor(text,bigint) from public; grant execute on function public.kekurangan_vendor(text,bigint) to anon, authenticated;

-- ================= PENAGIHAN =================
create or replace function public.tagih_daftar(kode text, p_vendor bigint)
 returns table(id bigint, dibuat timestamptz, status text, janji_kirim date, tgl_janji_dicatat date, catatan text, jumlah_pengingat int, terakhir_diingatkan timestamptz, selesai_pada timestamptz)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select t.id, t.dibuat, t.status, t.janji_kirim, t.tgl_janji_dicatat, t.catatan, t.jumlah_pengingat, t.terakhir_diingatkan, t.selesai_pada
    from public.tagih_vendor t where t.vendor_id = p_vendor order by t.dibuat desc limit 30;
end $f$;
revoke all on function public.tagih_daftar(text,bigint) from public; grant execute on function public.tagih_daftar(text,bigint) to anon, authenticated;

-- catat tanggal janji kirim dari vendor
create or replace function public.tagih_janji(kode text, p_id bigint, p_janji date, p_catatan text) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if p_janji is null then raise exception 'tanggal janji kirim wajib diisi'; end if;
  update public.tagih_vendor set janji_kirim = p_janji, tgl_janji_dicatat = current_date, status = 'dijanjikan',
         catatan = nullif(trim(coalesce(p_catatan, '')), ''), pengingat_oto_untuk = null
   where id = p_id and status <> 'selesai';
  if not found then raise exception 'penagihan tidak ditemukan atau sudah selesai'; end if;
end $f$;
revoke all on function public.tagih_janji(text,bigint,date,text) from public; grant execute on function public.tagih_janji(text,bigint,date,text) to anon, authenticated;

create or replace function public.tagih_selesai(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  update public.tagih_vendor set status = 'selesai', selesai_pada = now() where id = p_id and status <> 'selesai';
end $f$;
revoke all on function public.tagih_selesai(text,bigint) from public; grant execute on function public.tagih_selesai(text,bigint) to anon, authenticated;
