-- Alasan revisi pimpinan, Retur barang, dan Stock opname.
-- Retur dan opname memakai buku besar `stok_gerak` yang sudah ada (kolom `sumber` menandai asalnya),
-- jadi saldo di `daftar_stok()` otomatis ikut. Semua penulisan memakai kode akses seperti modul lain.

-- ================= ALASAN REVISI =================
alter table public.permintaan add column if not exists alasan_yasir text, add column if not exists alasan_ferry text;

drop function if exists public.daftar_permintaan();
create or replace function public.daftar_permintaan()
 returns table(id bigint, dibuat timestamp with time zone, lokasi_form text, client text, bagian_kerja text, jumlah_anggota integer, rab bigint, items jsonb, total_beli bigint, total_jual bigint, untung bigint, memo text, terkirim boolean, status text, diputuskan timestamp with time zone, status_yasir text, status_ferry text, diputuskan_yasir timestamp with time zone, diputuskan_ferry timestamp with time zone, terkirim_yasir boolean, terkirim_ferry boolean, diploting_pada timestamp with time zone, alasan_yasir text, alasan_ferry text)
 language sql security definer set search_path to 'public' as $f$
  select p.id, p.dibuat, p.lokasi_form, p.client, p.bagian_kerja, p.jumlah_anggota, p.rab, p.items, p.total_beli, p.total_jual, p.untung, p.memo, p.terkirim, p.status, p.diputuskan,
         p.status_yasir, p.status_ferry, p.diputuskan_yasir, p.diputuskan_ferry, p.terkirim_yasir, p.terkirim_ferry, p.diploting_pada, p.alasan_yasir, p.alasan_ferry
  from public.permintaan p order by p.dibuat desc limit 500 $f$;
revoke all on function public.daftar_permintaan() from public; grant execute on function public.daftar_permintaan() to anon;

-- ================= RETUR & OPNAME: penanda asal gerak stok =================
alter table public.stok_gerak add column if not exists sumber text check (sumber in ('retur','opname'));

drop function if exists public.daftar_stok_gerak(int);
create or replace function public.daftar_stok_gerak(p_batas int default 400)
 returns table(id bigint, waktu timestamptz, tanggal date, jenis text, item_no int, item_nama text, jenis_ukuran text, ukuran text, qty int,
               supplier text, no_dokumen text, pengiriman_id bigint, tujuan text, keterangan text, sumber text)
 language sql security definer set search_path to 'public' as $f$
  select g.id, g.waktu, g.tanggal, g.jenis, g.item_no, g.item_nama, g.jenis_ukuran, g.ukuran, g.qty, g.supplier, g.no_dokumen, g.pengiriman_id,
         case when p.id is null then null else p.client || ' - ' || p.bagian_kerja end, g.keterangan, g.sumber
  from public.stok_gerak g left join public.pengiriman p on p.id = g.pengiriman_id
  order by g.waktu desc, g.id desc limit greatest(1, least(coalesce(p_batas,400), 1000)) $f$;
revoke all on function public.daftar_stok_gerak(int) from public; grant execute on function public.daftar_stok_gerak(int) to anon;

-- ================= RETUR =================
-- p_arah = 'dari_lokasi' : barang kembali dari lokasi/karyawan ke gudang (stok bertambah, boleh menyebut pengiriman asal)
-- p_arah = 'ke_supplier' : barang dikembalikan ke supplier (stok berkurang, ditolak bila stok tidak cukup)
create or replace function public.catat_retur(kode text, p_tanggal date, p_arah text, p_pengiriman bigint, p_supplier text, p_alasan text, p_baris jsonb) returns int
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare n int; v_sj text; v_kurang text;
begin
  perform public._wajib_kode(kode);
  if p_arah not in ('dari_lokasi','ke_supplier') then raise exception 'arah retur tidak dikenal'; end if;
  if coalesce(trim(p_alasan),'') = '' then raise exception 'alasan retur wajib diisi'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang diretur'; end if;
  perform pg_advisory_xact_lock(7101);
  if p_arah = 'ke_supplier' then
    if coalesce(trim(p_supplier),'') = '' then raise exception 'nama supplier wajib diisi'; end if;
    select string_agg(h.nama || ' ' || (b->>'jenis_ukuran') || ' ' || coalesce(nullif(b->>'ukuran',''),'-') || ' (retur ' || (b->>'qty') || ', stok ' || coalesce(s.saldo,0) || ')', '; ') into v_kurang
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int
    left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo from public.stok_gerak g group by 1,2,3) s
      on s.item_no = (b->>'item_no')::int and s.jenis_ukuran = (b->>'jenis_ukuran') and s.ukuran = coalesce(nullif(b->>'ukuran',''),'-')
    where coalesce(s.saldo,0) < (b->>'qty')::int;
    if v_kurang is not null then raise exception 'stok tidak cukup untuk diretur: %', v_kurang; end if;
  else
    if p_pengiriman is not null then
      select no_surat_jalan into v_sj from public.pengiriman where id = p_pengiriman;
      if not found then raise exception 'pengiriman asal tidak ditemukan'; end if;
    end if;
  end if;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, supplier, no_dokumen, keterangan, pengiriman_id, sumber)
    select coalesce(p_tanggal, current_date), case when p_arah = 'dari_lokasi' then 'masuk' else 'keluar' end, (b->>'item_no')::int, h.nama,
           coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'), (b->>'qty')::int,
           case when p_arah = 'ke_supplier' then left(trim(p_supplier),120) end, v_sj,
           left((case when p_arah = 'dari_lokasi' then 'Retur dari lokasi: ' else 'Retur ke supplier: ' end) || trim(p_alasan), 300),
           case when p_arah = 'dari_lokasi' then p_pengiriman end, 'retur'
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return n;
end $f$;
revoke all on function public.catat_retur(text,date,text,bigint,text,text,jsonb) from public;
grant execute on function public.catat_retur(text,date,text,bigint,text,text,jsonb) to anon;

-- ================= STOCK OPNAME =================
create table if not exists public.opname (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  tanggal date not null default current_date,
  catatan text, jumlah_baris int not null default 0, jumlah_selisih int not null default 0);
create table if not exists public.opname_item (
  id bigint generated always as identity primary key,
  opname_id bigint not null references public.opname(id) on delete cascade,
  item_no int not null, item_nama text not null, jenis_ukuran text not null, ukuran text not null,
  sistem int not null, fisik int not null, selisih int not null);
alter table public.opname enable row level security;      revoke all on public.opname from anon, authenticated;
alter table public.opname_item enable row level security; revoke all on public.opname_item from anon, authenticated;

-- p_baris: [{item_no, jenis_ukuran, ukuran, fisik}]. Saldo sistem dihitung ulang di server; selisih dicatat sebagai gerak masuk/keluar.
create or replace function public.simpan_opname(kode text, p_tanggal date, p_catatan text, p_baris jsonb) returns jsonb
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare v_id bigint; v_tgl date := coalesce(p_tanggal, current_date); v_baris int; v_sel int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada baris opname'; end if;
  perform pg_advisory_xact_lock(7101);
  create temp table _op on commit drop as
    select (b->>'item_no')::int as item_no, h.nama as item_nama, b->>'jenis_ukuran' as jenis_ukuran, coalesce(nullif(b->>'ukuran',''),'-') as ukuran, (b->>'fisik')::int as fisik,
           coalesce(s.saldo,0)::int as sistem
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int
    left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo from public.stok_gerak g group by 1,2,3) s
      on s.item_no = (b->>'item_no')::int and s.jenis_ukuran = (b->>'jenis_ukuran') and s.ukuran = coalesce(nullif(b->>'ukuran',''),'-');
  if (select count(*) from _op) <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  if exists (select 1 from _op where fisik < 0) then raise exception 'jumlah fisik tidak boleh negatif'; end if;
  select count(*), count(*) filter (where fisik <> sistem) into v_baris, v_sel from _op;
  insert into public.opname (tanggal, catatan, jumlah_baris, jumlah_selisih) values (v_tgl, left(p_catatan,300), v_baris, v_sel) returning opname.id into v_id;
  insert into public.opname_item (opname_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, selisih)
    select v_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, fisik - sistem from _op;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, no_dokumen, keterangan, sumber)
    select v_tgl, case when fisik > sistem then 'masuk' else 'keluar' end, item_no, item_nama, jenis_ukuran, ukuran, abs(fisik - sistem),
           'OPNAME-' || v_id, 'Penyesuaian stock opname (sistem ' || sistem || ', fisik ' || fisik || ')', 'opname'
    from _op where fisik <> sistem;
  return jsonb_build_object('id', v_id, 'baris', v_baris, 'selisih', v_sel);
end $f$;
revoke all on function public.simpan_opname(text,date,text,jsonb) from public;
grant execute on function public.simpan_opname(text,date,text,jsonb) to anon;

create or replace function public.daftar_opname()
 returns table(id bigint, dibuat timestamptz, tanggal date, catatan text, jumlah_baris int, jumlah_selisih int, rincian jsonb)
 language sql security definer set search_path to 'public' as $f$
  select o.id, o.dibuat, o.tanggal, o.catatan, o.jumlah_baris, o.jumlah_selisih,
         coalesce((select jsonb_agg(jsonb_build_object('item_nama', i.item_nama, 'jenis_ukuran', i.jenis_ukuran, 'ukuran', i.ukuran, 'sistem', i.sistem, 'fisik', i.fisik, 'selisih', i.selisih) order by i.item_no, i.ukuran)
                   from public.opname_item i where i.opname_id = o.id and i.selisih <> 0), '[]'::jsonb)
  from public.opname o order by o.dibuat desc limit 100 $f$;
revoke all on function public.daftar_opname() from public; grant execute on function public.daftar_opname() to anon;
