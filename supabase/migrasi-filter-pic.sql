-- Bahan untuk filter cabang / PIC di semua halaman: peta penugasan lokasi. Hanya nama cabang, nama PIC, dan pasangan lokasi-cabang-PIC
-- (tanpa telepon atau catatan; itu tetap hanya untuk admin yang login lewat admin_daftar_pic).
create or replace function public.daftar_penugasan_publik() returns jsonb
 language sql stable security definer set search_path to 'public' as $f$
  select jsonb_build_object(
    'cabang', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.nama) order by (c.jenis = 'pusat') desc, c.nama), '[]'::jsonb) from public.cabang c where c.aktif),
    'pic',    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nama', p.nama, 'cabang_id', p.cabang_id) order by p.nama), '[]'::jsonb) from public.pic_lapangan p where p.aktif),
    'lokasi', (select coalesce(jsonb_agg(jsonb_build_object('l', upper(l.lokasi), 'c', l.cabang_id, 'p', l.pic_id)), '[]'::jsonb) from public.lokasi_penugasan l)) $f$;
revoke all on function public.daftar_penugasan_publik() from public;
grant execute on function public.daftar_penugasan_publik() to anon, authenticated;
