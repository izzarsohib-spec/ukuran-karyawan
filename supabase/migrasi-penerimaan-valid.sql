-- Penerimaan barang dari supplier: nama supplier harus vendor aktif (atau "Online") dan disimpan dengan ejaan baku vendor,
-- supaya perhitungan kekurangan vendor tidak meleset karena salah ketik. Plus pemeriksaan kelebihan / ukuran yang tidak dipesan.
create or replace function public.catat_barang_masuk(kode text, p_tanggal date, p_supplier text, p_no_dokumen text, p_keterangan text, p_baris jsonb) returns integer
 language plpgsql security definer set search_path to 'public', 'extensions' as $f$
declare n int; sup text;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dimasukkan'; end if;
  if coalesce(trim(p_supplier),'') = '' then raise exception 'nama supplier wajib diisi'; end if;
  select v.nama into sup from public.vendor v where v.aktif and lower(btrim(v.nama)) = lower(btrim(p_supplier)) limit 1;
  if sup is null and lower(btrim(p_supplier)) = 'online' then sup := 'Online'; end if;
  if sup is null then raise exception 'supplier "%" tidak dikenal: pilih vendor yang terdaftar di Administrator > Vendor, atau Online', left(p_supplier, 60); end if;
  if exists (select 1 from jsonb_array_elements(p_baris) b where coalesce((b->>'qty')::int, 0) <= 0) then raise exception 'qty harus lebih dari 0'; end if;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, supplier, no_dokumen, keterangan)
    select coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), 'masuk', (b->>'item_no')::int, h.nama, coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'),
           (b->>'qty')::int, sup, left(p_no_dokumen,80), left(p_keterangan,300)
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return n;
end $f$;

-- peringatan sebelum menyimpan: ukuran yang tidak ada di pesanan vendor, atau qty melebihi kekurangan saat ini
create or replace function public.periksa_penerimaan(kode text, p_supplier text, p_baris jsonb) returns table(pesan text)
 language plpgsql stable security definer set search_path to 'public' as $f$
declare vid bigint;
begin
  perform public._wajib_kode(kode);
  select v.id into vid from public.vendor v where v.aktif and lower(btrim(v.nama)) = lower(btrim(p_supplier)) limit 1;
  if vid is null then return; end if;
  return query
    with k as (select item_no, jenis, ukuran, dipesan, diterima from public.kekurangan_vendor_dasar(vid)),
    m as (select (b->>'item_no')::int as item_no, nullif(b->>'jenis_ukuran','') as jenis, nullif(b->>'ukuran','') as ukuran, sum((b->>'qty')::int) as qty
          from jsonb_array_elements(p_baris) b group by 1, 2, 3)
    select case when k.item_no is null then h.nama || ' ' || coalesce(m.jenis, '') || ' ' || coalesce(m.ukuran, '') || ': tidak ada di pesanan vendor ini (PO belum ditandai terkirim, atau ukuran salah)'
                else h.nama || ' ' || coalesce(m.jenis, '') || ' ' || coalesce(m.ukuran, '') || ': diterima ' || m.qty || ' tetapi kekurangan hanya ' || greatest(0, k.dipesan - k.diterima) end
    from m join public.harga_seragam h on h.no = m.item_no
    left join k on k.item_no = m.item_no and k.jenis = m.jenis and k.ukuran = m.ukuran
    where m.jenis is not null and m.jenis <> '-' and (k.item_no is null or m.qty > greatest(0, k.dipesan - k.diterima));
end $f$;
revoke all on function public.periksa_penerimaan(text, text, jsonb) from public; grant execute on function public.periksa_penerimaan(text, text, jsonb) to anon, authenticated;
