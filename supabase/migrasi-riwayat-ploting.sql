-- Riwayat ploting: kapan sebuah permintaan diploting dan kapan diubah.
-- Dicatat otomatis oleh trigger tiap kali permintaan.diploting_pada terisi atau berganti,
-- jadi jalur lewat simpan_ploting maupun lewat kirim-permintaan sama-sama tercatat.
create table if not exists public.ploting_riwayat (
  id bigserial primary key,
  permintaan_id bigint not null references public.permintaan(id) on delete cascade,
  waktu timestamptz not null default now(),
  aksi text not null check (aksi in ('diplot', 'diubah'))
);
create index if not exists ploting_riwayat_waktu on public.ploting_riwayat (waktu desc);
alter table public.ploting_riwayat enable row level security;

create or replace function public.tr_riwayat_ploting() returns trigger
 language plpgsql security definer set search_path to 'public' as $f$
begin
  if new.diploting_pada is not null and (tg_op = 'INSERT' or new.diploting_pada is distinct from old.diploting_pada) then
    insert into public.ploting_riwayat (permintaan_id, waktu, aksi)
    values (new.id, new.diploting_pada, case when tg_op = 'INSERT' or old.diploting_pada is null then 'diplot' else 'diubah' end);
  end if;
  return new;
end $f$;

drop trigger if exists riwayat_ploting on public.permintaan;
create trigger riwayat_ploting after insert or update of diploting_pada on public.permintaan
  for each row execute function public.tr_riwayat_ploting();

-- permintaan yang sudah terlanjur diploting: satu baris awal dari waktu ploting terakhirnya
insert into public.ploting_riwayat (permintaan_id, waktu, aksi)
  select p.id, p.diploting_pada, 'diplot' from public.permintaan p
  where p.diploting_pada is not null and not exists (select 1 from public.ploting_riwayat r where r.permintaan_id = p.id);

-- dibaca halaman Ploting (tanpa nama karyawan, hanya lokasi dan bagian kerja)
create or replace function public.daftar_riwayat_ploting()
 returns table(id bigint, permintaan_id bigint, waktu timestamptz, aksi text, lokasi_form text, client text, bagian_kerja text)
 language sql stable security definer set search_path to 'public' as $f$
  select r.id, r.permintaan_id, r.waktu, r.aksi, p.lokasi_form, p.client, p.bagian_kerja
  from public.ploting_riwayat r join public.permintaan p on p.id = r.permintaan_id
  order by r.waktu desc, r.id desc limit 500 $f$;
revoke all on function public.daftar_riwayat_ploting() from public;
grant execute on function public.daftar_riwayat_ploting() to anon, authenticated;
