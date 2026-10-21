-- Inventaris (buku besar gerak stok), Pengiriman, dan Tagihan.
-- Semua tabel tertutup untuk anon; akses lewat fungsi security definer. Membaca daftar bersifat terbuka (tanpa nama karyawan),
-- menulis dan membaca nama karyawan memakai kode akses (hash di tabel pengaturan).

-- ---------- pembantu: periksa kode akses ----------
create or replace function public._wajib_kode(kode text) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  if encode(digest(convert_to(kode,'utf8'),'sha256'),'hex') is distinct from (select nilai from public.pengaturan where kunci='kode_hash') then
    raise exception 'kode akses salah';
  end if;
end $f$;
revoke all on function public._wajib_kode(text) from public, anon, authenticated;

-- ---------- tabel ----------
create table if not exists public.pengiriman (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  tanggal date not null default current_date,
  no_surat_jalan text not null unique,
  permintaan_id bigint not null references public.permintaan(id),
  lokasi_form text, client text, bagian_kerja text,
  ekspedisi text, no_resi text, penerima text, keterangan text,
  status text not null default 'dikirim' check (status in ('dikirim','diterima')),
  diterima_pada timestamptz);
create table if not exists public.pengiriman_item (
  id bigint generated always as identity primary key,
  pengiriman_id bigint not null references public.pengiriman(id) on delete cascade,
  ploting_id bigint not null unique references public.ploting(id),
  nama text not null, item_no int not null, item_nama text not null, qty int not null check (qty > 0),
  ukuran_baju text, ukuran_celana text, ukuran_sepatu text);
create table if not exists public.stok_gerak (
  id bigint generated always as identity primary key,
  waktu timestamptz not null default now(),
  tanggal date not null default current_date,
  jenis text not null check (jenis in ('masuk','keluar')),
  item_no int not null, item_nama text not null,
  jenis_ukuran text not null check (jenis_ukuran in ('baju','celana','sepatu','-')),
  ukuran text not null default '-',
  qty int not null check (qty > 0),
  supplier text, no_dokumen text, keterangan text,
  pengiriman_id bigint references public.pengiriman(id));
create index if not exists stok_gerak_item_idx on public.stok_gerak (item_no, jenis_ukuran, ukuran);
create table if not exists public.tagihan (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  no_invoice text not null unique,
  tanggal date not null default current_date, jatuh_tempo date,
  permintaan_id bigint not null references public.permintaan(id),
  lokasi_form text, client text, bagian_kerja text,
  total bigint not null default 0, terbayar bigint not null default 0,
  status text not null default 'belum' check (status in ('belum','sebagian','lunas','batal')),
  catatan text);
create table if not exists public.tagihan_item (
  id bigint generated always as identity primary key,
  tagihan_id bigint not null references public.tagihan(id) on delete cascade,
  item_no int not null, item_nama text not null, qty int not null, harga bigint not null, subtotal bigint not null);
create table if not exists public.tagihan_bayar (
  id bigint generated always as identity primary key,
  tagihan_id bigint not null references public.tagihan(id) on delete cascade,
  tanggal date not null default current_date, jumlah bigint not null check (jumlah > 0), keterangan text,
  dibuat timestamptz not null default now());
alter table public.pengiriman enable row level security;      revoke all on public.pengiriman from anon, authenticated;
alter table public.pengiriman_item enable row level security; revoke all on public.pengiriman_item from anon, authenticated;
alter table public.stok_gerak enable row level security;      revoke all on public.stok_gerak from anon, authenticated;
alter table public.tagihan enable row level security;         revoke all on public.tagihan from anon, authenticated;
alter table public.tagihan_item enable row level security;    revoke all on public.tagihan_item from anon, authenticated;
alter table public.tagihan_bayar enable row level security;   revoke all on public.tagihan_bayar from anon, authenticated;

-- ploting yang sudah mulai dikirim tidak boleh diubah lagi
create or replace function public.simpan_ploting(kode text, p_permintaan bigint, p_rincian jsonb) returns int
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r public.permintaan%rowtype; n int;
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if exists (select 1 from public.pengiriman where permintaan_id = p_permintaan) then
    raise exception 'ploting tidak bisa diubah karena sudah ada pengiriman';
  end if;
  if jsonb_typeof(p_rincian) <> 'array' or jsonb_array_length(p_rincian) = 0 then raise exception 'rincian ploting kosong'; end if;
  if exists (
    select 1
    from (select (i->>'no')::int as no, sum((i->>'qty')::int) as q from jsonb_array_elements(r.items) i group by 1) a
    full join (select (x->>'item_no')::int as no, sum((x->>'qty')::int) as q from jsonb_array_elements(p_rincian) x group by 1) b on a.no = b.no
    where coalesce(a.q,0) <> coalesce(b.q,0)) then
    raise exception 'jumlah ploting tidak sama dengan jumlah permintaan';
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
revoke all on function public.simpan_ploting(text,bigint,jsonb) from public;
grant execute on function public.simpan_ploting(text,bigint,jsonb) to anon;

-- ================= INVENTARIS =================
create or replace function public.catat_barang_masuk(kode text, p_tanggal date, p_supplier text, p_no_dokumen text, p_keterangan text, p_baris jsonb) returns int
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare n int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dimasukkan'; end if;
  if coalesce(trim(p_supplier),'') = '' then raise exception 'nama supplier wajib diisi'; end if;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, supplier, no_dokumen, keterangan)
    select coalesce(p_tanggal, current_date), 'masuk', (b->>'item_no')::int, h.nama, coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'),
           (b->>'qty')::int, left(trim(p_supplier),120), left(p_no_dokumen,80), left(p_keterangan,300)
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return n;
end $f$;
revoke all on function public.catat_barang_masuk(text,date,text,text,text,jsonb) from public;
grant execute on function public.catat_barang_masuk(text,date,text,text,text,jsonb) to anon;

create or replace function public.daftar_stok()
 returns table(item_no int, item_nama text, jenis_ukuran text, ukuran text, masuk bigint, keluar bigint, saldo bigint)
 language sql security definer set search_path to 'public' as $f$
  select g.item_no, max(g.item_nama), g.jenis_ukuran, g.ukuran,
         coalesce(sum(g.qty) filter (where g.jenis='masuk'),0)::bigint, coalesce(sum(g.qty) filter (where g.jenis='keluar'),0)::bigint,
         (coalesce(sum(g.qty) filter (where g.jenis='masuk'),0) - coalesce(sum(g.qty) filter (where g.jenis='keluar'),0))::bigint
  from public.stok_gerak g group by g.item_no, g.jenis_ukuran, g.ukuran order by g.item_no, g.jenis_ukuran, g.ukuran $f$;
revoke all on function public.daftar_stok() from public; grant execute on function public.daftar_stok() to anon;

create or replace function public.daftar_stok_gerak(p_batas int default 400)
 returns table(id bigint, waktu timestamptz, tanggal date, jenis text, item_no int, item_nama text, jenis_ukuran text, ukuran text, qty int,
               supplier text, no_dokumen text, pengiriman_id bigint, tujuan text, keterangan text)
 language sql security definer set search_path to 'public' as $f$
  select g.id, g.waktu, g.tanggal, g.jenis, g.item_no, g.item_nama, g.jenis_ukuran, g.ukuran, g.qty, g.supplier, g.no_dokumen, g.pengiriman_id,
         case when p.id is null then null else p.client || ' - ' || p.bagian_kerja end, g.keterangan
  from public.stok_gerak g left join public.pengiriman p on p.id = g.pengiriman_id
  order by g.waktu desc, g.id desc limit greatest(1, least(coalesce(p_batas,400), 1000)) $f$;
revoke all on function public.daftar_stok_gerak(int) from public; grant execute on function public.daftar_stok_gerak(int) to anon;

-- ================= PENGIRIMAN =================
create or replace function public.daftar_progres_kirim()
 returns table(permintaan_id bigint, total_qty bigint, terkirim_qty bigint)
 language sql security definer set search_path to 'public' as $f$
  select p.permintaan_id, sum(p.qty)::bigint,
         coalesce(sum(p.qty) filter (where exists (select 1 from public.pengiriman_item pi where pi.ploting_id = p.id)),0)::bigint
  from public.ploting p group by p.permintaan_id $f$;
revoke all on function public.daftar_progres_kirim() from public; grant execute on function public.daftar_progres_kirim() to anon;

create or replace function public.siap_kirim(kode text, p_permintaan bigint)
 returns table(id bigint, nama text, item_no int, item_nama text, qty int, ukuran_baju text, ukuran_celana text, ukuran_sepatu text, pengiriman_id bigint, no_surat_jalan text)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select p.id, p.nama, p.item_no, p.item_nama, p.qty, p.ukuran_baju, p.ukuran_celana, p.ukuran_sepatu, g.id, g.no_surat_jalan
    from public.ploting p left join public.pengiriman_item pi on pi.ploting_id = p.id left join public.pengiriman g on g.id = pi.pengiriman_id
    where p.permintaan_id = p_permintaan order by p.nama, p.item_no;
end $f$;
revoke all on function public.siap_kirim(text,bigint) from public; grant execute on function public.siap_kirim(text,bigint) to anon;

create or replace function public.catat_pengiriman(kode text, p_permintaan bigint, p_tanggal date, p_ekspedisi text, p_resi text, p_penerima text, p_keterangan text, p_ploting_ids bigint[])
 returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r public.permintaan%rowtype; v_id bigint; v_no text; v_seq int; v_kurang text; v_tgl date := coalesce(p_tanggal, current_date);
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where permintaan.id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if coalesce(array_length(p_ploting_ids,1),0) = 0 then raise exception 'tidak ada barang yang dipilih'; end if;
  perform pg_advisory_xact_lock(7101);
  if exists (select 1 from unnest(p_ploting_ids) i left join public.ploting p on p.id = i where p.id is null or p.permintaan_id <> p_permintaan) then
    raise exception 'ada baris ploting yang tidak valid';
  end if;
  if exists (select 1 from public.pengiriman_item pi where pi.ploting_id = any(p_ploting_ids)) then
    raise exception 'ada barang yang sudah pernah dikirim';
  end if;
  create temp table _butuh on commit drop as
    select u.item_no, max(u.item_nama) as item_nama, u.jenis, u.ukuran, sum(u.qty)::int as q from (
      select p.item_no, p.item_nama, 'baju'::text as jenis, p.ukuran_baju as ukuran, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_baju is not null
      union all select p.item_no, p.item_nama, 'celana', p.ukuran_celana, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_celana is not null
      union all select p.item_no, p.item_nama, 'sepatu', p.ukuran_sepatu, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_sepatu is not null
      union all select p.item_no, p.item_nama, '-', '-', p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_baju is null and p.ukuran_celana is null and p.ukuran_sepatu is null
    ) u group by u.item_no, u.jenis, u.ukuran;
  select string_agg(b.item_nama || ' ' || b.jenis || ' ' || b.ukuran || ' (butuh ' || b.q || ', stok ' || coalesce(s.saldo,0) || ')', '; ') into v_kurang
  from _butuh b left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo
                           from public.stok_gerak g group by 1,2,3) s on s.item_no = b.item_no and s.jenis_ukuran = b.jenis and s.ukuran = b.ukuran
  where coalesce(s.saldo,0) < b.q;
  if v_kurang is not null then raise exception 'stok tidak cukup: %', v_kurang; end if;
  select count(*) + 1 into v_seq from public.pengiriman where date_trunc('month', dibuat) = date_trunc('month', now());
  v_no := 'SJ/' || to_char(now(),'YYYY/MM') || '/' || lpad(v_seq::text, 4, '0');
  insert into public.pengiriman (tanggal, no_surat_jalan, permintaan_id, lokasi_form, client, bagian_kerja, ekspedisi, no_resi, penerima, keterangan)
    values (v_tgl, v_no, r.id, r.lokasi_form, r.client, r.bagian_kerja, left(p_ekspedisi,100), left(p_resi,100), left(p_penerima,150), left(p_keterangan,300))
    returning pengiriman.id into v_id;
  insert into public.pengiriman_item (pengiriman_id, ploting_id, nama, item_no, item_nama, qty, ukuran_baju, ukuran_celana, ukuran_sepatu)
    select v_id, p.id, p.nama, p.item_no, p.item_nama, p.qty, p.ukuran_baju, p.ukuran_celana, p.ukuran_sepatu from public.ploting p where p.id = any(p_ploting_ids);
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, no_dokumen, pengiriman_id)
    select v_tgl, 'keluar', b.item_no, b.item_nama, b.jenis, b.ukuran, b.q, v_no, v_id from _butuh b;
  return jsonb_build_object('id', v_id, 'no_surat_jalan', v_no);
end $f$;
revoke all on function public.catat_pengiriman(text,bigint,date,text,text,text,text,bigint[]) from public;
grant execute on function public.catat_pengiriman(text,bigint,date,text,text,text,text,bigint[]) to anon;

create or replace function public.daftar_pengiriman()
 returns table(id bigint, dibuat timestamptz, tanggal date, no_surat_jalan text, permintaan_id bigint, lokasi_form text, client text, bagian_kerja text,
               ekspedisi text, no_resi text, penerima text, keterangan text, status text, diterima_pada timestamptz, jumlah_pcs bigint)
 language sql security definer set search_path to 'public' as $f$
  select g.id, g.dibuat, g.tanggal, g.no_surat_jalan, g.permintaan_id, g.lokasi_form, g.client, g.bagian_kerja, g.ekspedisi, g.no_resi, g.penerima, g.keterangan, g.status, g.diterima_pada,
         coalesce((select sum(pi.qty) from public.pengiriman_item pi where pi.pengiriman_id = g.id),0)::bigint
  from public.pengiriman g order by g.dibuat desc limit 500 $f$;
revoke all on function public.daftar_pengiriman() from public; grant execute on function public.daftar_pengiriman() to anon;

create or replace function public.detail_pengiriman(kode text, p_id bigint)
 returns table(nama text, item_no int, item_nama text, qty int, ukuran_baju text, ukuran_celana text, ukuran_sepatu text)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select pi.nama, pi.item_no, pi.item_nama, pi.qty, pi.ukuran_baju, pi.ukuran_celana, pi.ukuran_sepatu
    from public.pengiriman_item pi where pi.pengiriman_id = p_id order by pi.nama, pi.item_no;
end $f$;
revoke all on function public.detail_pengiriman(text,bigint) from public; grant execute on function public.detail_pengiriman(text,bigint) to anon;

create or replace function public.tandai_diterima(kode text, p_id bigint) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  update public.pengiriman set status = 'diterima', diterima_pada = now() where id = p_id and status = 'dikirim';
  if not found then raise exception 'pengiriman tidak ditemukan atau sudah diterima'; end if;
end $f$;
revoke all on function public.tandai_diterima(text,bigint) from public; grant execute on function public.tandai_diterima(text,bigint) to anon;

-- ================= TAGIHAN =================
create or replace function public.buat_tagihan(kode text, p_permintaan bigint, p_tanggal date, p_jatuh_tempo date, p_catatan text) returns jsonb
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r public.permintaan%rowtype; v_ploting bigint; v_kirim bigint; v_id bigint; v_no text; v_seq int;
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where permintaan.id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  perform pg_advisory_xact_lock(7102);
  select coalesce(sum(p.qty),0) into v_ploting from public.ploting p where p.permintaan_id = p_permintaan;
  select coalesce(sum(pi.qty),0) into v_kirim from public.pengiriman_item pi join public.pengiriman g on g.id = pi.pengiriman_id where g.permintaan_id = p_permintaan;
  if v_ploting = 0 or v_kirim < v_ploting then raise exception 'pengiriman belum selesai (% dari % pcs terkirim)', v_kirim, v_ploting; end if;
  if exists (select 1 from public.tagihan t where t.permintaan_id = p_permintaan and t.status <> 'batal') then raise exception 'tagihan untuk permintaan ini sudah ada'; end if;
  select count(*) + 1 into v_seq from public.tagihan where date_trunc('month', dibuat) = date_trunc('month', now());
  v_no := 'INV/' || to_char(now(),'YYYY/MM') || '/' || lpad(v_seq::text, 4, '0');
  insert into public.tagihan (no_invoice, tanggal, jatuh_tempo, permintaan_id, lokasi_form, client, bagian_kerja, catatan)
    values (v_no, coalesce(p_tanggal, current_date), p_jatuh_tempo, r.id, r.lokasi_form, r.client, r.bagian_kerja, left(p_catatan,300)) returning tagihan.id into v_id;
  insert into public.tagihan_item (tagihan_id, item_no, item_nama, qty, harga, subtotal)
    select v_id, a.item_no, a.nama, a.q, h.p, a.q * h.p
    from (select pi.item_no, max(pi.item_nama) as nama, sum(pi.qty)::int as q from public.pengiriman_item pi join public.pengiriman g on g.id = pi.pengiriman_id
          where g.permintaan_id = p_permintaan group by pi.item_no) a
    cross join lateral (select coalesce((select (i->>'jual')::bigint from jsonb_array_elements(r.items) i where (i->>'no')::int = a.item_no limit 1),
                                        (select hs.harga_jual from public.harga_seragam hs where hs.no = a.item_no), 0)::bigint as p) h;
  update public.tagihan t set total = (select coalesce(sum(ti.subtotal),0) from public.tagihan_item ti where ti.tagihan_id = v_id) where t.id = v_id;
  return jsonb_build_object('id', v_id, 'no_invoice', v_no);
end $f$;
revoke all on function public.buat_tagihan(text,bigint,date,date,text) from public; grant execute on function public.buat_tagihan(text,bigint,date,date,text) to anon;

create or replace function public.catat_bayar(kode text, p_tagihan bigint, p_tanggal date, p_jumlah bigint, p_keterangan text) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare t public.tagihan%rowtype; baru bigint;
begin
  perform public._wajib_kode(kode);
  select * into t from public.tagihan where id = p_tagihan for update;
  if not found then raise exception 'tagihan tidak ditemukan'; end if;
  if t.status = 'batal' then raise exception 'tagihan sudah dibatalkan'; end if;
  if coalesce(p_jumlah,0) <= 0 then raise exception 'jumlah pembayaran harus lebih dari 0'; end if;
  if t.terbayar + p_jumlah > t.total then raise exception 'pembayaran melebihi sisa tagihan (sisa %)', t.total - t.terbayar; end if;
  insert into public.tagihan_bayar (tagihan_id, tanggal, jumlah, keterangan) values (p_tagihan, coalesce(p_tanggal, current_date), p_jumlah, left(p_keterangan,200));
  baru := t.terbayar + p_jumlah;
  update public.tagihan set terbayar = baru, status = case when baru >= total then 'lunas' when baru > 0 then 'sebagian' else 'belum' end where id = p_tagihan;
end $f$;
revoke all on function public.catat_bayar(text,bigint,date,bigint,text) from public; grant execute on function public.catat_bayar(text,bigint,date,bigint,text) to anon;

create or replace function public.batalkan_tagihan(kode text, p_tagihan bigint) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  update public.tagihan set status = 'batal' where id = p_tagihan and terbayar = 0 and status <> 'batal';
  if not found then raise exception 'tagihan tidak bisa dibatalkan (tidak ditemukan atau sudah ada pembayaran)'; end if;
end $f$;
revoke all on function public.batalkan_tagihan(text,bigint) from public; grant execute on function public.batalkan_tagihan(text,bigint) to anon;

create or replace function public.daftar_tagihan()
 returns table(id bigint, dibuat timestamptz, no_invoice text, tanggal date, jatuh_tempo date, permintaan_id bigint, lokasi_form text, client text, bagian_kerja text,
               total bigint, terbayar bigint, status text, catatan text, items jsonb, bayar jsonb)
 language sql security definer set search_path to 'public' as $f$
  select t.id, t.dibuat, t.no_invoice, t.tanggal, t.jatuh_tempo, t.permintaan_id, t.lokasi_form, t.client, t.bagian_kerja, t.total, t.terbayar, t.status, t.catatan,
         coalesce((select jsonb_agg(jsonb_build_object('item_no', i.item_no, 'item_nama', i.item_nama, 'qty', i.qty, 'harga', i.harga, 'subtotal', i.subtotal) order by i.item_no) from public.tagihan_item i where i.tagihan_id = t.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('tanggal', b.tanggal, 'jumlah', b.jumlah, 'keterangan', b.keterangan) order by b.tanggal, b.id) from public.tagihan_bayar b where b.tagihan_id = t.id), '[]'::jsonb)
  from public.tagihan t order by t.dibuat desc limit 500 $f$;
revoke all on function public.daftar_tagihan() from public; grant execute on function public.daftar_tagihan() to anon;
