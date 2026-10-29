-- Surat konfirmasi kekurangan ke vendor (lewat ntfy): "berdasarkan pengiriman tanggal ..., masih ada kekurangan ..., mohon konfirmasi kapan dikirim".
--  - kekurangan_catat.tgl_pengiriman : tanggal pengiriman yang menjadi dasar surat
--  - konfirmasi_vendor.jenis / catat_id : surat pesanan (jenis 'pesanan') atau surat kekurangan (jenis 'kekurangan', terhubung ke catatan kekurangan)
-- Jawaban vendor (tanggal) otomatis menjadi kekurangan_catat.estimasi_kirim (dilakukan fungsi server konfirmasi-vendor).
-- Dijalankan setelah migrasi-catatan-kekurangan.sql dan migrasi-konfirmasi-vendor.sql.

alter table public.kekurangan_catat add column if not exists tgl_pengiriman date;
alter table public.konfirmasi_vendor add column if not exists jenis text not null default 'pesanan';
alter table public.konfirmasi_vendor add column if not exists catat_id bigint references public.kekurangan_catat(id) on delete set null;

drop function if exists public.catat_kekurangan(text, date, text, text, date, text, jsonb);
create or replace function public.catat_kekurangan(kode text, p_tanggal date, p_vendor text, p_referensi text, p_estimasi date, p_keterangan text, p_baris jsonb, p_tgl_pengiriman date default null) returns bigint
 language plpgsql security definer set search_path to 'public', 'extensions' as $f$
declare vnama text; nid bigint; n int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dicatat'; end if;
  if coalesce(trim(p_vendor),'') = '' then raise exception 'vendor wajib diisi'; end if;
  select v.nama into vnama from public.vendor v where v.aktif and lower(btrim(v.nama)) = lower(btrim(p_vendor)) limit 1;
  if vnama is null then raise exception 'vendor "%" tidak dikenal: pilih vendor yang terdaftar di Administrator > Vendor', left(p_vendor, 60); end if;
  if exists (select 1 from jsonb_array_elements(p_baris) b where coalesce((b->>'qty')::int, 0) <= 0) then raise exception 'qty harus lebih dari 0'; end if;
  insert into public.kekurangan_catat (tanggal, vendor, referensi, estimasi_kirim, keterangan, tgl_pengiriman)
    values (coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), vnama, left(p_referensi, 80), p_estimasi, left(p_keterangan, 300), p_tgl_pengiriman) returning id into nid;
  insert into public.kekurangan_catat_item (catat_id, item_no, item_nama, jenis_ukuran, ukuran, qty)
    select nid, (b->>'item_no')::int, h.nama, coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'), (b->>'qty')::int
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return nid;
end $f$;
revoke all on function public.catat_kekurangan(text, date, text, text, date, text, jsonb, date) from public;
grant execute on function public.catat_kekurangan(text, date, text, text, date, text, jsonb, date) to anon, authenticated;

drop function if exists public.daftar_kekurangan_catat(text);
create or replace function public.daftar_kekurangan_catat(kode text)
 returns table(id bigint, tanggal date, vendor text, referensi text, estimasi_kirim date, keterangan text, status text, dibuat timestamptz,
               item_no int, item_nama text, jenis_ukuran text, ukuran text, qty int, tgl_pengiriman date)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query
    select c.id, c.tanggal, c.vendor, c.referensi, c.estimasi_kirim, c.keterangan, c.status, c.dibuat, i.item_no, i.item_nama, i.jenis_ukuran, i.ukuran, i.qty, c.tgl_pengiriman
    from public.kekurangan_catat c join public.kekurangan_catat_item i on i.catat_id = c.id
    order by c.tanggal desc, c.id desc, i.id limit 3000;
end $f$;
revoke all on function public.daftar_kekurangan_catat(text) from public;
grant execute on function public.daftar_kekurangan_catat(text) to anon, authenticated;

drop function if exists public.daftar_konfirmasi_vendor(text);
create or replace function public.daftar_konfirmasi_vendor(kode text)
 returns table(id bigint, vendor text, permintaan_ids bigint[], ringkasan jsonb, dikirim_pada timestamptz, status text, estimasi date, catatan text, dijawab_pada timestamptz, jumlah_jawab int, jenis text, catat_id bigint)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select k.id, k.vendor, k.permintaan_ids, k.ringkasan, k.dikirim_pada, k.status, k.estimasi, k.catatan, k.dijawab_pada, k.jumlah_jawab, k.jenis, k.catat_id
    from public.konfirmasi_vendor k order by k.id desc limit 200;
end $f$;
revoke all on function public.daftar_konfirmasi_vendor(text) from public;
grant execute on function public.daftar_konfirmasi_vendor(text) to anon, authenticated;
