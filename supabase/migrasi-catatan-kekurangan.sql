-- Catatan kekurangan dari vendor (dicatat manual): barang, jenis, ukuran, qty yang kurang, plus janji/estimasi kirim.
-- Terpisah dari hitungan otomatis kekurangan_vendor_dasar (dipesan - diterima); catatan ini adalah apa yang disampaikan vendor.
-- Hanya admin (login) yang bisa membaca dan menulis (memakai _wajib_kode seperti fungsi barang masuk).

create table if not exists public.kekurangan_catat (
  id bigint generated always as identity primary key,
  tanggal date not null default ((now() at time zone 'Asia/Jakarta')::date),
  vendor text not null,
  referensi text,                       -- no. PO / surat jalan terkait
  estimasi_kirim date,
  keterangan text,
  status text not null default 'terbuka' check (status in ('terbuka', 'terpenuhi', 'batal')),
  dibuat timestamptz not null default now(),
  ditutup_pada timestamptz
);
create table if not exists public.kekurangan_catat_item (
  id bigint generated always as identity primary key,
  catat_id bigint not null references public.kekurangan_catat(id) on delete cascade,
  item_no int not null,
  item_nama text not null,
  jenis_ukuran text not null default '-',
  ukuran text not null default '-',
  qty int not null check (qty > 0)
);
create index if not exists kekurangan_catat_item_idx on public.kekurangan_catat_item (catat_id);
alter table public.kekurangan_catat enable row level security;      revoke all on public.kekurangan_catat from anon, authenticated;
alter table public.kekurangan_catat_item enable row level security; revoke all on public.kekurangan_catat_item from anon, authenticated;

create or replace function public.catat_kekurangan(kode text, p_tanggal date, p_vendor text, p_referensi text, p_estimasi date, p_keterangan text, p_baris jsonb) returns bigint
 language plpgsql security definer set search_path to 'public', 'extensions' as $f$
declare vnama text; nid bigint; n int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dicatat'; end if;
  if coalesce(trim(p_vendor),'') = '' then raise exception 'vendor wajib diisi'; end if;
  select v.nama into vnama from public.vendor v where v.aktif and lower(btrim(v.nama)) = lower(btrim(p_vendor)) limit 1;
  if vnama is null then raise exception 'vendor "%" tidak dikenal: pilih vendor yang terdaftar di Administrator > Vendor', left(p_vendor, 60); end if;
  if exists (select 1 from jsonb_array_elements(p_baris) b where coalesce((b->>'qty')::int, 0) <= 0) then raise exception 'qty harus lebih dari 0'; end if;
  insert into public.kekurangan_catat (tanggal, vendor, referensi, estimasi_kirim, keterangan)
    values (coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), vnama, left(p_referensi, 80), p_estimasi, left(p_keterangan, 300)) returning id into nid;
  insert into public.kekurangan_catat_item (catat_id, item_no, item_nama, jenis_ukuran, ukuran, qty)
    select nid, (b->>'item_no')::int, h.nama, coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'), (b->>'qty')::int
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return nid;
end $f$;
revoke all on function public.catat_kekurangan(text, date, text, text, date, text, jsonb) from public; grant execute on function public.catat_kekurangan(text, date, text, text, date, text, jsonb) to anon, authenticated;

create or replace function public.daftar_kekurangan_catat(kode text)
 returns table(id bigint, tanggal date, vendor text, referensi text, estimasi_kirim date, keterangan text, status text, dibuat timestamptz,
               item_no int, item_nama text, jenis_ukuran text, ukuran text, qty int)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query
    select c.id, c.tanggal, c.vendor, c.referensi, c.estimasi_kirim, c.keterangan, c.status, c.dibuat, i.item_no, i.item_nama, i.jenis_ukuran, i.ukuran, i.qty
    from public.kekurangan_catat c join public.kekurangan_catat_item i on i.catat_id = c.id
    order by c.tanggal desc, c.id desc, i.id limit 3000;
end $f$;
revoke all on function public.daftar_kekurangan_catat(text) from public; grant execute on function public.daftar_kekurangan_catat(text) to anon, authenticated;

create or replace function public.tutup_kekurangan(kode text, p_id bigint, p_status text) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if p_status not in ('terpenuhi', 'batal', 'terbuka') then raise exception 'status tidak dikenal'; end if;
  update public.kekurangan_catat set status = p_status, ditutup_pada = case when p_status = 'terbuka' then null else now() end where id = p_id;
  if not found then raise exception 'catatan tidak ditemukan'; end if;
end $f$;
revoke all on function public.tutup_kekurangan(text, bigint, text) from public; grant execute on function public.tutup_kekurangan(text, bigint, text) to anon, authenticated;
