-- Penagihan vendor yang fleksibel: estimasi kirim PER BARANG, pesanan susulan menambah kekurangan otomatis, dan riwayat pengiriman vendor.
-- Menggantikan tabel penagihan per putaran (tagih_vendor) yang belum dipakai; kekurangan tetap dihitung otomatis (kekurangan_vendor_dasar):
--   kekurangan = dipesan (semua permintaan disetujui, per ukuran) - diterima dari supplier. Pesanan baru yang disetujui otomatis menambah kekurangan.
-- Estimasi (janji) melekat pada jumlah kekurangan saat dicatat. Bila kekurangan bertambah lagi, tambahannya ditandai "belum ada estimasi";
-- bila tanggal estimasi lewat dan masih ada kekurangan, estimasi itu dianggap meleset dan vendor dimintai estimasi baru.

drop function if exists public.tagih_daftar(text, bigint);
drop function if exists public.tagih_janji(text, bigint, date, text);
drop function if exists public.tagih_selesai(text, bigint);
drop table if exists public.tagih_vendor cascade;

-- satu estimasi per barang (komponen: mis. BAJU PDH); hanya satu yang berstatus 'aktif' per vendor + barang
create table if not exists public.janji_vendor (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendor(id),
  grup text not null check (grup in ('Baju', 'Celana', 'Sepatu')),
  label text not null,
  qty int not null check (qty > 0),                 -- jumlah kekurangan yang dicakup estimasi saat dicatat
  tgl_dicatat date not null default current_date,
  tgl_janji date not null,
  catatan text,
  status text not null default 'aktif' check (status in ('aktif', 'diganti', 'batal', 'terpenuhi')),
  dibuat timestamptz not null default now(),
  ditutup_pada timestamptz,
  pengingat_oto_untuk date,                         -- tgl_janji yang sudah dibuatkan pengingat otomatis sebelum deadline
  lanjutan_untuk date,                              -- tgl_janji yang sudah dibuatkan tindak lanjut otomatis setelah deadline lewat
  jumlah_pengingat int not null default 0,
  terakhir_diingatkan timestamptz
);
create unique index if not exists janji_vendor_aktif_uniq on public.janji_vendor (vendor_id, label) where status = 'aktif';
create index if not exists janji_vendor_vendor on public.janji_vendor (vendor_id, dibuat desc);

-- catatan tiap pesan penagihan yang terkirim (untuk jejak; PDF-nya tersimpan di Storage)
create table if not exists public.tagih_log (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendor(id),
  dibuat timestamptz not null default now(),
  jenis text not null check (jenis in ('tagih', 'ingatkan', 'lanjutan')),
  cara text not null default 'manual' check (cara in ('manual', 'otomatis')),
  jumlah_barang int not null default 0,
  total_kurang int not null default 0,
  pdf_url text
);
alter table public.janji_vendor enable row level security; revoke all on public.janji_vendor from anon, authenticated;
alter table public.tagih_log enable row level security;    revoke all on public.tagih_log from anon, authenticated;

-- ================= ESTIMASI =================
create or replace function public.janji_daftar(kode text, p_vendor bigint)
 returns table(id bigint, grup text, label text, qty int, tgl_dicatat date, tgl_janji date, catatan text, status text, dibuat timestamptz, jumlah_pengingat int, terakhir_diingatkan timestamptz)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select j.id, j.grup, j.label, j.qty, j.tgl_dicatat, j.tgl_janji, j.catatan, j.status, j.dibuat, j.jumlah_pengingat, j.terakhir_diingatkan
    from public.janji_vendor j where j.vendor_id = p_vendor and j.status in ('aktif', 'terpenuhi') order by j.dibuat desc limit 300;
end $f$;
revoke all on function public.janji_daftar(text, bigint) from public; grant execute on function public.janji_daftar(text, bigint) to anon, authenticated;

-- catat estimasi satu barang; estimasi aktif sebelumnya untuk barang yang sama diganti (jejaknya tetap tersimpan)
create or replace function public.janji_simpan(kode text, p_vendor bigint, p_grup text, p_label text, p_qty int, p_tgl date, p_catatan text) returns bigint
 language plpgsql security definer set search_path to 'public' as $f$
declare rid bigint;
begin
  perform public._wajib_kode(kode);
  if p_tgl is null then raise exception 'tanggal estimasi wajib diisi'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'jumlah yang diestimasi harus lebih dari 0'; end if;
  if not exists (select 1 from public.vendor where id = p_vendor) then raise exception 'vendor tidak ditemukan'; end if;
  update public.janji_vendor set status = 'diganti', ditutup_pada = now() where vendor_id = p_vendor and label = p_label and status = 'aktif';
  insert into public.janji_vendor (vendor_id, grup, label, qty, tgl_dicatat, tgl_janji, catatan)
    values (p_vendor, p_grup, left(p_label, 200), p_qty, current_date, p_tgl, nullif(trim(coalesce(p_catatan, '')), '')) returning id into rid;
  return rid;
end $f$;
revoke all on function public.janji_simpan(text, bigint, text, text, int, date, text) from public; grant execute on function public.janji_simpan(text, bigint, text, text, int, date, text) to anon, authenticated;

create or replace function public.janji_batal(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  update public.janji_vendor set status = 'batal', ditutup_pada = now() where id = p_id and status = 'aktif';
end $f$;
revoke all on function public.janji_batal(text, bigint) from public; grant execute on function public.janji_batal(text, bigint) to anon, authenticated;

-- ================= RIWAYAT PENGIRIMAN VENDOR =================
-- Per tanggal + nomor dokumen: barang yang diterima, dan sisa kekurangan SESUDAH pengiriman itu
-- (pesanan yang sudah disetujui sampai tanggal itu dikurangi semua penerimaan sampai pengiriman itu).
create or replace function public.riwayat_vendor_dasar(p_vendor bigint)
 returns table(tanggal date, no_dokumen text, total bigint, rincian jsonb, kurang_setelah bigint)
 language sql stable security definer set search_path to 'public' as $f$
  with v as (select lower(btrim(nama)) as nm from public.vendor where id = p_vendor),
  masuk as (
    select s.tanggal, coalesce(nullif(btrim(s.no_dokumen), ''), '-') as dok, s.item_no, s.item_nama, s.jenis_ukuran as jenis, s.ukuran, s.qty
    from public.stok_gerak s, v
    where lower(btrim(coalesce(s.supplier, ''))) = v.nm and s.jenis = 'masuk' and s.sumber is null),
  pesan as (
    select u.item_no, u.jenis, u.ukuran, g.qty, coalesce(greatest(p.diputuskan_yasir, p.diputuskan_ferry), p.diputuskan, p.dibuat)::date as tgl_setuju
    from public.ploting g
    join public.permintaan p on p.id = g.permintaan_id
    cross join lateral (values (g.item_no, 'baju', g.ukuran_baju), (g.item_no, 'celana', g.ukuran_celana), (g.item_no, 'sepatu', g.ukuran_sepatu)) as u(item_no, jenis, ukuran)
    where u.ukuran is not null
      and coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui'),
  grp as (
    select m.tanggal, m.dok, sum(m.qty)::bigint as total,
           jsonb_agg(jsonb_build_object('item_no', m.item_no, 'item_nama', m.item_nama, 'jenis', m.jenis, 'ukuran', m.ukuran, 'qty', m.qty) order by m.item_no, m.jenis, m.ukuran) as rincian
    from masuk m group by m.tanggal, m.dok)
  select g.tanggal, g.dok, g.total, g.rincian,
    (select coalesce(sum(greatest(0, o.q - coalesce(r.q, 0))), 0)::bigint
       from (select item_no, jenis, ukuran, sum(qty) as q from pesan where tgl_setuju <= g.tanggal group by item_no, jenis, ukuran) o
       left join (select m.item_no, m.jenis, m.ukuran, sum(m.qty) as q from masuk m where (m.tanggal, m.dok) <= (g.tanggal, g.dok) group by m.item_no, m.jenis, m.ukuran) r
         on r.item_no = o.item_no and r.jenis = o.jenis and r.ukuran = o.ukuran)
  from grp g order by g.tanggal desc, g.dok desc $f$;
revoke all on function public.riwayat_vendor_dasar(bigint) from public, anon, authenticated;
grant execute on function public.riwayat_vendor_dasar(bigint) to service_role;

create or replace function public.riwayat_vendor(kode text, p_vendor bigint)
 returns table(tanggal date, no_dokumen text, total bigint, rincian jsonb, kurang_setelah bigint)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select * from public.riwayat_vendor_dasar(p_vendor);
end $f$;
revoke all on function public.riwayat_vendor(text, bigint) from public; grant execute on function public.riwayat_vendor(text, bigint) to anon, authenticated;
