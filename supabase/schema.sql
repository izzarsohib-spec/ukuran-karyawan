-- Tabel utama: berisi nama, TIDAK terbuka untuk publik
create table if not exists public.ukuran_pekerja (
  id            bigint generated always as identity primary key,
  kunci         text unique not null,      -- tab|timestamp|nama, dipakai untuk upsert
  waktu         timestamptz,
  lokasi        text,
  bagian_kerja  text,
  nama          text,
  ukuran_baju   text,
  ukuran_celana text,
  ukuran_sepatu text,
  sumber_tab    text,
  diperbarui    timestamptz default now()
);

alter table public.ukuran_pekerja enable row level security;
-- sengaja tanpa policy: anon/authenticated tidak bisa membaca tabel ini.
-- Skrip Apps Script menulis memakai service_role (melewati RLS).

-- View publik: tanpa kolom nama
create or replace view public.ukuran_publik as
  select id, waktu, lokasi, bagian_kerja, ukuran_baju, ukuran_celana, ukuran_sepatu
  from public.ukuran_pekerja;

revoke all on public.ukuran_pekerja from anon, authenticated;
grant select on public.ukuran_publik to anon;

create index if not exists ukuran_pekerja_lokasi_idx on public.ukuran_pekerja (lokasi);
