-- Permintaan seragam bertahap ("boleh sebagian, sisanya menyusul"): sistem perlu tahu siapa saja yang sudah dipesankan.
-- Hanya menambah dua fungsi baru; tidak mengubah tabel atau fungsi yang sudah ada. Permintaan yang ditolak/direvisi tidak dihitung
-- (akan dibuat ulang), sama seperti perhitungan RAB.

-- Jumlah penerima berbeda per lokasi + bagian. Tanpa nama, jadi boleh dibaca publik (dipakai untuk label "Menyusul N orang").
create or replace function public.cakupan_permintaan()
 returns table(lokasi_form text, bagian_kerja text, penerima int)
 language sql stable security definer set search_path to 'public' as $f$
  select g.lokasi_form, g.bagian_kerja, count(distinct upper(btrim(g.nama)))::int
  from public.ploting g join public.permintaan p on p.id = g.permintaan_id
  where coalesce(p.status_yasir, p.status, 'menunggu') <> 'ditolak' and coalesce(p.status_ferry, p.status, 'menunggu') <> 'ditolak'
  group by g.lokasi_form, g.bagian_kerja $f$;
revoke all on function public.cakupan_permintaan() from public;
grant execute on function public.cakupan_permintaan() to anon, authenticated;

-- Nama yang sudah dipesankan untuk satu lokasi + bagian (memuat nama karyawan, jadi hanya admin yang login).
create or replace function public.penerima_sebelumnya(kode text, p_lokasi text, p_bagian text)
 returns table(nama text, permintaan_id bigint)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query
    select distinct on (upper(btrim(g.nama))) g.nama, g.permintaan_id
    from public.ploting g join public.permintaan p on p.id = g.permintaan_id
    where g.lokasi_form = p_lokasi and g.bagian_kerja = p_bagian
      and coalesce(p.status_yasir, p.status, 'menunggu') <> 'ditolak' and coalesce(p.status_ferry, p.status, 'menunggu') <> 'ditolak'
    order by upper(btrim(g.nama)), g.permintaan_id desc;
end $f$;
revoke all on function public.penerima_sebelumnya(text, text, text) from public;
grant execute on function public.penerima_sebelumnya(text, text, text) to anon, authenticated;
