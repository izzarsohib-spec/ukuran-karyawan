-- Administrator mencakup semua pengeditan data acuan Seragam dan Peralatan: daftar lokasi peralatan kini juga mengeluarkan awal masa kontrak
-- (kontrak_mulai) supaya bisa diubah dari halaman Administrator (tersimpan lewat peralatan_atur_kontrak).
drop function if exists public.peralatan_kelola_lokasi();
create function public.peralatan_kelola_lokasi()
 returns table(id bigint, nama text, bagian text, anggota int, kontrak_bulan int, anggaran_per_orang numeric, rab numeric, seragam_lokasi_form text, aktif boolean, dari_sumber boolean, jumlah_permintaan int, kontrak_mulai date)
 language sql security definer set search_path to 'public' as $f$
  select l.id, l.nama, l.bagian, l.anggota, l.kontrak_bulan, l.anggaran_per_orang, l.rab, l.seragam_lokasi_form, l.aktif, l.dari_sumber,
         (select count(*)::int from public.peralatan_permintaan p where p.lokasi_id = l.id), l.kontrak_mulai
  from public.peralatan_lokasi l order by l.nama $f$;
revoke all on function public.peralatan_kelola_lokasi() from public; grant execute on function public.peralatan_kelola_lokasi() to anon, authenticated;
