-- Catatan tambahan untuk Laporan Harian (kegiatan lain, kendala, rencana). Satu baris per tanggal.
-- Membaca dan menulis memakai kode akses karena isinya catatan internal.
create table if not exists public.laporan_harian (
  tanggal date primary key,
  kegiatan text, kendala text, rencana text,
  diperbarui timestamptz not null default now());
alter table public.laporan_harian enable row level security;
revoke all on public.laporan_harian from anon, authenticated;

create or replace function public.simpan_laporan(kode text, p_tanggal date, p_kegiatan text, p_kendala text, p_rencana text) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  if p_tanggal is null then raise exception 'tanggal wajib diisi'; end if;
  if coalesce(trim(p_kegiatan),'') = '' and coalesce(trim(p_kendala),'') = '' and coalesce(trim(p_rencana),'') = '' then
    delete from public.laporan_harian where tanggal = p_tanggal;
  else
    insert into public.laporan_harian (tanggal, kegiatan, kendala, rencana)
      values (p_tanggal, left(p_kegiatan,4000), left(p_kendala,4000), left(p_rencana,4000))
    on conflict (tanggal) do update set kegiatan = excluded.kegiatan, kendala = excluded.kendala, rencana = excluded.rencana, diperbarui = now();
  end if;
end $f$;
revoke all on function public.simpan_laporan(text,date,text,text,text) from public;
grant execute on function public.simpan_laporan(text,date,text,text,text) to anon;

create or replace function public.daftar_laporan(kode text, p_dari date, p_sampai date)
 returns table(tanggal date, kegiatan text, kendala text, rencana text, diperbarui timestamptz)
 language plpgsql security definer set search_path to 'public','extensions' as $f$
begin
  perform public._wajib_kode(kode);
  return query select l.tanggal, l.kegiatan, l.kendala, l.rencana, l.diperbarui
    from public.laporan_harian l where l.tanggal between p_dari and p_sampai order by l.tanggal;
end $f$;
revoke all on function public.daftar_laporan(text,date,date) from public;
grant execute on function public.daftar_laporan(text,date,date) to anon;
