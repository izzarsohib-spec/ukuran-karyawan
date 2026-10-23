-- Langkah "PO dikirim ke vendor": kekurangan vendor baru dihitung sejak PO benar-benar dikirim (bukan sejak disetujui),
-- dan perubahan ukuran sesudah PO dikirim wajib beralasan serta tercatat.
alter table public.permintaan add column if not exists po_dikirim date;
alter table public.permintaan add column if not exists po_dicatat timestamptz;

-- permintaan yang sudah disetujui sebelum fitur ini dianggap PO-nya terkirim pada tanggal persetujuan (perilaku lama tidak berubah)
update public.permintaan set po_dikirim = coalesce(greatest(diputuskan_yasir, diputuskan_ferry), diputuskan, dibuat)::date, po_dicatat = now()
 where po_dikirim is null and coalesce(status_yasir, status, 'menunggu') = 'disetujui' and coalesce(status_ferry, status, 'menunggu') = 'disetujui';

-- daftar permintaan ikut membawa tanggal PO
drop function if exists public.daftar_permintaan();
create function public.daftar_permintaan()
 returns table(id bigint, dibuat timestamp with time zone, lokasi_form text, client text, bagian_kerja text, jumlah_anggota integer, rab bigint, items jsonb, total_beli bigint, total_jual bigint, untung bigint, memo text, terkirim boolean, status text, diputuskan timestamp with time zone, status_yasir text, status_ferry text, diputuskan_yasir timestamp with time zone, diputuskan_ferry timestamp with time zone, terkirim_yasir boolean, terkirim_ferry boolean, diploting_pada timestamp with time zone, alasan_yasir text, alasan_ferry text, po_dikirim date)
 language sql security definer set search_path to 'public' as $f$
  select p.id, p.dibuat, p.lokasi_form, p.client, p.bagian_kerja, p.jumlah_anggota, p.rab, p.items, p.total_beli, p.total_jual, p.untung, p.memo, p.terkirim, p.status, p.diputuskan,
         p.status_yasir, p.status_ferry, p.diputuskan_yasir, p.diputuskan_ferry, p.terkirim_yasir, p.terkirim_ferry, p.diploting_pada, p.alasan_yasir, p.alasan_ferry, p.po_dikirim
  from public.permintaan p order by p.dibuat desc limit 500 $f$;
revoke all on function public.daftar_permintaan() from public; grant execute on function public.daftar_permintaan() to anon;

-- tandai PO sudah dikirim ke vendor (hanya permintaan yang sudah disetujui kedua pimpinan); tanggal bisa dipilih
create or replace function public.po_tandai(kode text, p_ids bigint[], p_tanggal date default null) returns int
 language plpgsql security definer set search_path to 'public' as $f$
declare n int; tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
begin
  perform public._wajib_kode(kode);
  if tgl > (now() at time zone 'Asia/Jakarta')::date then raise exception 'tanggal PO tidak boleh di masa depan'; end if;
  update public.permintaan set po_dikirim = tgl, po_dicatat = now()
   where id = any(p_ids) and coalesce(status_yasir, status, 'menunggu') = 'disetujui' and coalesce(status_ferry, status, 'menunggu') = 'disetujui';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'tidak ada permintaan yang bisa ditandai (harus disetujui kedua pimpinan)'; end if;
  return n;
end $f$;
revoke all on function public.po_tandai(text,bigint[],date) from public; grant execute on function public.po_tandai(text,bigint[],date) to anon, authenticated;

-- batalkan tanda PO (salah tandai); tidak bisa bila barangnya sudah ada pengirimannya ke lokasi
create or replace function public.po_batal(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  if exists (select 1 from public.pengiriman where permintaan_id = p_id) then raise exception 'tidak bisa dibatalkan: sudah ada pengiriman ke lokasi'; end if;
  update public.permintaan set po_dikirim = null, po_dicatat = null where id = p_id;
end $f$;
revoke all on function public.po_batal(text,bigint) from public; grant execute on function public.po_batal(text,bigint) to anon, authenticated;

-- kekurangan dan riwayat vendor: hanya pesanan yang PO-nya sudah dikirim
create or replace function public.kekurangan_vendor_dasar(p_vendor bigint)
 returns table(item_no int, item_nama text, kategori text, jenis text, ukuran text, dipesan bigint, diterima bigint)
 language sql stable security definer set search_path to 'public' as $f$
  with v as (select lower(btrim(nama)) as nm from public.vendor where id = p_vendor),
  pesan as (
    select g.item_no, max(g.item_nama) as item_nama, u.jenis, u.ukuran, sum(g.qty)::bigint as q
    from public.ploting g
    join public.permintaan p on p.id = g.permintaan_id
    cross join lateral (values ('baju', g.ukuran_baju), ('celana', g.ukuran_celana), ('sepatu', g.ukuran_sepatu)) as u(jenis, ukuran)
    where u.ukuran is not null and p.po_dikirim is not null
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

create or replace function public.riwayat_vendor_dasar(p_vendor bigint)
 returns table(tanggal date, no_dokumen text, total bigint, rincian jsonb, kurang_setelah bigint)
 language sql stable security definer set search_path to 'public' as $f$
  with v as (select lower(btrim(nama)) as nm from public.vendor where id = p_vendor),
  masuk as (
    select s.tanggal, coalesce(nullif(btrim(s.no_dokumen), ''), '-') as dok, s.item_no, s.item_nama, s.jenis_ukuran as jenis, s.ukuran, s.qty
    from public.stok_gerak s, v
    where lower(btrim(coalesce(s.supplier, ''))) = v.nm and s.jenis = 'masuk' and s.sumber is null),
  pesan as (
    select u.item_no, u.jenis, u.ukuran, g.qty, p.po_dikirim as tgl_setuju
    from public.ploting g
    join public.permintaan p on p.id = g.permintaan_id
    cross join lateral (values (g.item_no, 'baju', g.ukuran_baju), (g.item_no, 'celana', g.ukuran_celana), (g.item_no, 'sepatu', g.ukuran_sepatu)) as u(item_no, jenis, ukuran)
    where u.ukuran is not null and p.po_dikirim is not null
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

-- log perubahan ukuran sesudah PO dikirim
create table if not exists public.ploting_revisi (
  id bigserial primary key, permintaan_id bigint not null references public.permintaan(id), waktu timestamptz not null default now(),
  alasan text not null, rincian_lama jsonb not null);
alter table public.ploting_revisi enable row level security;

drop function if exists public.simpan_ploting(text, bigint, jsonb);
create function public.simpan_ploting(kode text, p_permintaan bigint, p_rincian jsonb, p_alasan text default null) returns integer
 language plpgsql security definer set search_path to 'public', 'extensions' as $f$
declare r public.permintaan%rowtype; n int;
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if exists (select 1 from public.pengiriman where permintaan_id = p_permintaan) then
    raise exception 'ploting tidak bisa diubah karena sudah ada pengiriman';
  end if;
  if r.po_dikirim is not null and coalesce(btrim(p_alasan), '') = '' then
    raise exception 'PO sudah dikirim ke vendor tanggal %: perubahan ukuran harus disertai alasan dan perlu diberitahukan ke vendor', to_char(r.po_dikirim, 'DD-MM-YYYY');
  end if;
  if jsonb_typeof(p_rincian) <> 'array' or jsonb_array_length(p_rincian) = 0 then raise exception 'rincian ploting kosong'; end if;
  if exists (
    select 1
    from (select (i->>'no')::int as no, sum((i->>'qty')::int) as q from jsonb_array_elements(r.items) i group by 1) a
    full join (select (x->>'item_no')::int as no, sum((x->>'qty')::int) as q from jsonb_array_elements(p_rincian) x group by 1) b on a.no = b.no
    where coalesce(a.q,0) <> coalesce(b.q,0)) then
    raise exception 'jumlah ploting tidak sama dengan jumlah permintaan';
  end if;
  if r.po_dikirim is not null then
    insert into public.ploting_revisi (permintaan_id, alasan, rincian_lama)
      select p_permintaan, left(btrim(p_alasan), 500), coalesce(jsonb_agg(jsonb_build_object('nama', g.nama, 'item_no', g.item_no, 'qty', g.qty, 'baju', g.ukuran_baju, 'celana', g.ukuran_celana, 'sepatu', g.ukuran_sepatu)), '[]'::jsonb)
      from public.ploting g where g.permintaan_id = p_permintaan;
  end if;
  delete from public.ploting where permintaan_id = p_permintaan;
  insert into public.ploting (permintaan_id, lokasi_form, bagian_kerja, nama, item_no, item_nama, qty, ukuran_baju, ukuran_celana, ukuran_sepatu)
    select p_permintaan, r.lokasi_form, r.bagian_kerja, left(x->>'nama', 200), (x->>'item_no')::int, left(x->>'item_nama', 200), (x->>'qty')::int,
           nullif(x->>'baju',''), nullif(x->>'celana',''), nullif(x->>'sepatu','')
    from jsonb_array_elements(p_rincian) x;
  get diagnostics n = row_count;
  update public.permintaan set diploting_pada = now() where id = p_permintaan;
  return n;
end $f$;
revoke all on function public.simpan_ploting(text, bigint, jsonb, text) from public; grant execute on function public.simpan_ploting(text, bigint, jsonb, text) to anon, authenticated;
