-- Modul PERALATAN (pengadaan peralatan kerja), terpisah dari seragam.
-- Anggaran peralatan terpisah dari anggaran seragam, tetapi sebuah permintaan boleh memakai anggaran seragam
-- (sumber_anggaran = 'seragam') untuk lokasi yang anggaran peralatannya kecil.
-- Pembelian kebanyakan online atau ke Wahyu Ardianto dan dibayar langsung, jadi tidak ada modul tagihan vendor di sini.
-- Semua tabel tertutup untuk anon (RLS aktif, hak dicabut); akses nanti lewat fungsi security definer seperti modul seragam.

create table if not exists public.peralatan_lokasi (
  id bigint generated always as identity primary key,
  nama text not null,
  bagian text not null default 'KEAMANAN',
  anggota int,
  kontrak_bulan int default 12,
  anggaran_per_orang numeric,
  rab numeric not null default 0,                 -- anggaran peralatan lokasi ini untuk seluruh masa kontrak
  dari_sumber boolean not null default true,      -- false = lokasi ditambahkan dari transaksi lama, belum ada di SUMBER DATA
  aktif boolean not null default true,
  catatan text,
  unique (nama, bagian));

create table if not exists public.peralatan_item (
  id bigint generated always as identity primary key,
  nama text not null unique,
  harga_beli numeric not null default 0,
  harga_jual numeric not null default 0,
  aktif boolean not null default true,
  perlu_ditinjau boolean not null default false,  -- item baru dari transaksi lama, harganya belum dibakukan
  catatan text);

create table if not exists public.peralatan_permintaan (
  id bigint generated always as identity primary key,
  dibuat timestamptz not null default now(),
  tanggal timestamptz,                            -- waktu pesanan menurut sheet lama; null bila tidak tercatat
  lokasi_id bigint not null references public.peralatan_lokasi(id),
  sumber_anggaran text not null default 'peralatan' check (sumber_anggaran in ('peralatan','seragam')),
  rab numeric not null default 0,
  anggota int,
  total_beli numeric not null default 0,
  total_jual numeric not null default 0,
  untung numeric not null default 0,              -- sisa RAB + (jual - beli); sisa RAB = rab - total jual (kumulatif per lokasi)
  status text not null default 'arsip' check (status in ('arsip','menunggu','disetujui','ditolak')),
  catatan text,
  asal text,                                      -- 'migrasi-sheet' untuk data dari spreadsheet lama
  no_sheet int, baris_sheet int);

create table if not exists public.peralatan_permintaan_item (
  id bigint generated always as identity primary key,
  permintaan_id bigint not null references public.peralatan_permintaan(id) on delete cascade,
  item_id bigint references public.peralatan_item(id),
  nama text not null,
  nama_asal text,                                 -- nama yang diketik di sheet lama bila diseragamkan
  qty int not null check (qty > 0),
  harga_beli numeric not null,
  harga_jual numeric not null,
  pemetaan text check (pemetaan in ('cocok','disamakan','tebakan','baru')));
create index if not exists peralatan_permintaan_lokasi_idx on public.peralatan_permintaan (lokasi_id);
create index if not exists peralatan_item_permintaan_idx on public.peralatan_permintaan_item (permintaan_id);

alter table public.peralatan_lokasi enable row level security;            revoke all on public.peralatan_lokasi from anon, authenticated;
alter table public.peralatan_item enable row level security;              revoke all on public.peralatan_item from anon, authenticated;
alter table public.peralatan_permintaan enable row level security;        revoke all on public.peralatan_permintaan from anon, authenticated;
alter table public.peralatan_permintaan_item enable row level security;   revoke all on public.peralatan_permintaan_item from anon, authenticated;
