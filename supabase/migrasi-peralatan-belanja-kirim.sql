-- Alur PERALATAN lanjutan: setelah disetujui kedua pimpinan -> belanja (online / Wahyu / lain, dibayar langsung) -> pengiriman ke lokasi -> diterima.
-- Riwayat per lokasi dibaca dari permintaan yang tidak ditolak; permintaan berikutnya pada kontrak yang sama menjadi "penambahan".
-- Penulisan lewat fungsi security definer yang meminta kode akses (sama dengan modul seragam); tabel tertutup untuk anon.

alter table public.peralatan_lokasi add column if not exists kontrak_mulai date;      -- awal masa kontrak berjalan (kosong = semua permintaan dianggap satu kontrak)
alter table public.peralatan_permintaan add column if not exists tahap text not null default 'belum'
  check (tahap in ('belum','dibelanjakan','dikirim','diterima'));
-- data lama dari spreadsheet dianggap sudah dibeli dan sampai di lokasi
update public.peralatan_permintaan set tahap = 'diterima' where status = 'arsip' and tahap = 'belum';

create table if not exists public.peralatan_belanja (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  tanggal date not null default current_date,
  permintaan_id bigint not null references public.peralatan_permintaan(id) on delete cascade,
  permintaan_item_id bigint not null references public.peralatan_permintaan_item(id) on delete cascade,
  qty int not null check (qty > 0),
  harga_satuan numeric not null check (harga_satuan >= 0),     -- harga beli yang sebenarnya dibayar
  tempat text not null default 'online' check (tempat in ('online','wahyu','lain')),
  toko text,
  catatan text);

create table if not exists public.peralatan_pengiriman (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  tanggal date not null default current_date,
  permintaan_id bigint not null references public.peralatan_permintaan(id) on delete cascade,
  kurir text, resi text, penerima text, catatan text,
  diterima date);                                              -- tanggal barang diterima di lokasi; null = masih di perjalanan

create table if not exists public.peralatan_pengiriman_item (
  id bigint generated always as identity primary key,
  pengiriman_id bigint not null references public.peralatan_pengiriman(id) on delete cascade,
  permintaan_item_id bigint not null references public.peralatan_permintaan_item(id) on delete cascade,
  qty int not null check (qty > 0));

create index if not exists peralatan_belanja_p_idx on public.peralatan_belanja (permintaan_id);
create index if not exists peralatan_kirim_p_idx on public.peralatan_pengiriman (permintaan_id);
create index if not exists peralatan_kirim_item_idx on public.peralatan_pengiriman_item (permintaan_item_id);
alter table public.peralatan_belanja enable row level security;          revoke all on public.peralatan_belanja from anon, authenticated;
alter table public.peralatan_pengiriman enable row level security;       revoke all on public.peralatan_pengiriman from anon, authenticated;
alter table public.peralatan_pengiriman_item enable row level security;  revoke all on public.peralatan_pengiriman_item from anon, authenticated;

-- ---------- fungsi baca ----------
drop function if exists public.peralatan_daftar_lokasi();
create function public.peralatan_daftar_lokasi()
 returns table(id bigint, nama text, bagian text, anggota int, kontrak_bulan int, rab numeric, terpakai numeric,
               seragam_lokasi_form text, seragam_bagian text, seragam_rab numeric, seragam_terpakai numeric, dari_sumber boolean, catatan text, kontrak_mulai date)
 language sql security definer set search_path to 'public' as $f$
  select l.id, l.nama, l.bagian, l.anggota, l.kontrak_bulan, l.rab,
         coalesce((select sum(p.total_jual) from public.peralatan_permintaan p where p.lokasi_id = l.id and p.sumber_anggaran = 'peralatan' and p.status <> 'ditolak'), 0),
         l.seragam_lokasi_form, l.seragam_bagian,
         (select a.anggaran from public.anggaran_publik a where a.lokasi_form = l.seragam_lokasi_form and a.bagian_kerja = l.seragam_bagian limit 1)::numeric,
         case when l.seragam_lokasi_form is null then null else
           coalesce((select sum(s.total_jual) from public.permintaan s where s.lokasi_form = l.seragam_lokasi_form and s.bagian_kerja = l.seragam_bagian and s.status is distinct from 'ditolak'), 0)
         + coalesce((select sum(p.total_jual) from public.peralatan_permintaan p join public.peralatan_lokasi l2 on l2.id = p.lokasi_id
                     where l2.seragam_lokasi_form = l.seragam_lokasi_form and l2.seragam_bagian = l.seragam_bagian and p.sumber_anggaran = 'seragam' and p.status <> 'ditolak'), 0) end,
         l.dari_sumber, l.catatan, l.kontrak_mulai
  from public.peralatan_lokasi l where l.aktif order by l.nama $f$;
revoke all on function public.peralatan_daftar_lokasi() from public; grant execute on function public.peralatan_daftar_lokasi() to anon;

drop function if exists public.peralatan_daftar_permintaan();
create function public.peralatan_daftar_permintaan()
 returns table(id bigint, dibuat timestamptz, tanggal timestamptz, lokasi_id bigint, lokasi text, sumber_anggaran text, rab numeric, anggota int,
               total_beli numeric, total_jual numeric, untung numeric, status text, status_yasir text, status_ferry text,
               diputuskan_yasir timestamptz, diputuskan_ferry timestamptz, alasan_yasir text, alasan_ferry text,
               terkirim_yasir boolean, terkirim_ferry boolean, memo text, asal text, catatan text, tahap text, beli_aktual numeric, items jsonb, belanja jsonb, pengiriman jsonb)
 language sql security definer set search_path to 'public' as $f$
  select p.id, p.dibuat, p.tanggal, p.lokasi_id, l.nama, p.sumber_anggaran, p.rab, p.anggota, p.total_beli, p.total_jual, p.untung, p.status,
         p.status_yasir, p.status_ferry, p.diputuskan_yasir, p.diputuskan_ferry, p.alasan_yasir, p.alasan_ferry, p.terkirim_yasir, p.terkirim_ferry, p.memo, p.asal, p.catatan, p.tahap,
         coalesce((select sum(b.qty * b.harga_satuan) from public.peralatan_belanja b where b.permintaan_id = p.id), 0),
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nama', i.nama, 'qty', i.qty, 'beli', i.harga_beli, 'jual', i.harga_jual,
                     'dibeli', coalesce((select sum(b.qty) from public.peralatan_belanja b where b.permintaan_item_id = i.id), 0),
                     'terkirim', coalesce((select sum(k.qty) from public.peralatan_pengiriman_item k where k.permintaan_item_id = i.id), 0)) order by i.id)
                   from public.peralatan_permintaan_item i where i.permintaan_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'tanggal', b.tanggal, 'nama', i.nama, 'qty', b.qty, 'harga', b.harga_satuan, 'tempat', b.tempat, 'toko', b.toko, 'catatan', b.catatan) order by b.tanggal, b.id)
                   from public.peralatan_belanja b join public.peralatan_permintaan_item i on i.id = b.permintaan_item_id where b.permintaan_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'tanggal', k.tanggal, 'kurir', k.kurir, 'resi', k.resi, 'penerima', k.penerima, 'catatan', k.catatan, 'diterima', k.diterima,
                     'items', (select jsonb_agg(jsonb_build_object('nama', i.nama, 'qty', ki.qty) order by ki.id) from public.peralatan_pengiriman_item ki join public.peralatan_permintaan_item i on i.id = ki.permintaan_item_id where ki.pengiriman_id = k.id)) order by k.tanggal, k.id)
                   from public.peralatan_pengiriman k where k.permintaan_id = p.id), '[]'::jsonb)
  from public.peralatan_permintaan p join public.peralatan_lokasi l on l.id = p.lokasi_id
  order by p.dibuat desc, p.id desc limit 600 $f$;
revoke all on function public.peralatan_daftar_permintaan() from public; grant execute on function public.peralatan_daftar_permintaan() to anon;

-- ---------- fungsi tulis (kode akses) ----------
create or replace function public.peralatan_catat_belanja(kode text, p_id bigint, p_tanggal date, p_tempat text, p_toko text, p_catatan text, p_baris jsonb) returns int
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r record; b jsonb; it record; sudah int; n int := 0;
begin
  perform public._wajib_kode(kode);
  select * into r from public.peralatan_permintaan where id = p_id;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if p_tempat not in ('online','wahyu','lain') then raise exception 'tempat belanja tidak valid'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dicatat'; end if;
  for b in select * from jsonb_array_elements(p_baris) loop
    select * into it from public.peralatan_permintaan_item where id = (b->>'item')::bigint and permintaan_id = p_id;
    if not found then raise exception 'item bukan bagian dari permintaan ini'; end if;
    if (b->>'qty')::int < 1 or (b->>'harga')::numeric < 0 then raise exception 'qty atau harga tidak valid'; end if;
    select coalesce(sum(qty),0) into sudah from public.peralatan_belanja where permintaan_item_id = it.id;
    if sudah + (b->>'qty')::int > it.qty then raise exception 'belanja % melebihi yang diminta (% dari %)', it.nama, sudah + (b->>'qty')::int, it.qty; end if;
    insert into public.peralatan_belanja (tanggal, permintaan_id, permintaan_item_id, qty, harga_satuan, tempat, toko, catatan)
      values (coalesce(p_tanggal, current_date), p_id, it.id, (b->>'qty')::int, (b->>'harga')::numeric, p_tempat, nullif(trim(p_toko),''), nullif(trim(p_catatan),''));
    n := n + 1;
  end loop;
  if r.tahap = 'belum' then update public.peralatan_permintaan set tahap = 'dibelanjakan' where id = p_id; end if;
  return n;
end $f$;
revoke all on function public.peralatan_catat_belanja(text,bigint,date,text,text,text,jsonb) from public; grant execute on function public.peralatan_catat_belanja(text,bigint,date,text,text,text,jsonb) to anon;

create or replace function public.peralatan_catat_kirim(kode text, p_id bigint, p_tanggal date, p_kurir text, p_resi text, p_penerima text, p_catatan text, p_baris jsonb) returns bigint
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r record; b jsonb; it record; dibeli int; terkirim int; kid bigint;
begin
  perform public._wajib_kode(kode);
  select * into r from public.peralatan_permintaan where id = p_id;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dikirim'; end if;
  insert into public.peralatan_pengiriman (tanggal, permintaan_id, kurir, resi, penerima, catatan)
    values (coalesce(p_tanggal, current_date), p_id, nullif(trim(p_kurir),''), nullif(trim(p_resi),''), nullif(trim(p_penerima),''), nullif(trim(p_catatan),'')) returning id into kid;
  for b in select * from jsonb_array_elements(p_baris) loop
    select * into it from public.peralatan_permintaan_item where id = (b->>'item')::bigint and permintaan_id = p_id;
    if not found then raise exception 'item bukan bagian dari permintaan ini'; end if;
    if (b->>'qty')::int < 1 then raise exception 'qty tidak valid'; end if;
    select coalesce(sum(qty),0) into dibeli from public.peralatan_belanja where permintaan_item_id = it.id;
    select coalesce(sum(qty),0) into terkirim from public.peralatan_pengiriman_item where permintaan_item_id = it.id;
    if terkirim + (b->>'qty')::int > dibeli then raise exception 'kirim % melebihi yang sudah dibeli (dibeli %, terkirim %)', it.nama, dibeli, terkirim; end if;
    insert into public.peralatan_pengiriman_item (pengiriman_id, permintaan_item_id, qty) values (kid, it.id, (b->>'qty')::int);
  end loop;
  update public.peralatan_permintaan set tahap = 'dikirim' where id = p_id and tahap in ('belum','dibelanjakan');
  return kid;
end $f$;
revoke all on function public.peralatan_catat_kirim(text,bigint,date,text,text,text,text,jsonb) from public; grant execute on function public.peralatan_catat_kirim(text,bigint,date,text,text,text,text,jsonb) to anon;

-- tandai satu pengiriman sudah diterima di lokasi; permintaan selesai bila semua barang terkirim dan semua pengirimannya diterima
create or replace function public.peralatan_tandai_diterima(kode text, p_kirim bigint, p_tanggal date) returns text
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare pid bigint; sisa int; blm int;
begin
  perform public._wajib_kode(kode);
  update public.peralatan_pengiriman set diterima = coalesce(p_tanggal, current_date) where id = p_kirim returning permintaan_id into pid;
  if pid is null then raise exception 'pengiriman tidak ditemukan'; end if;
  select coalesce(sum(i.qty - coalesce((select sum(k.qty) from public.peralatan_pengiriman_item k where k.permintaan_item_id = i.id),0)),0) into sisa from public.peralatan_permintaan_item i where i.permintaan_id = pid;
  select count(*) into blm from public.peralatan_pengiriman where permintaan_id = pid and diterima is null;
  if sisa = 0 and blm = 0 then update public.peralatan_permintaan set tahap = 'diterima' where id = pid; return 'diterima'; end if;
  return 'dikirim';
end $f$;
revoke all on function public.peralatan_tandai_diterima(text,bigint,date) from public; grant execute on function public.peralatan_tandai_diterima(text,bigint,date) to anon;

create or replace function public.peralatan_atur_kontrak(kode text, p_lokasi bigint, p_mulai date) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  update public.peralatan_lokasi set kontrak_mulai = p_mulai where id = p_lokasi;
  if not found then raise exception 'lokasi tidak ditemukan'; end if;
end $f$;
revoke all on function public.peralatan_atur_kontrak(text,bigint,date) from public; grant execute on function public.peralatan_atur_kontrak(text,bigint,date) to anon;
