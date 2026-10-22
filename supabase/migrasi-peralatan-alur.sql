-- Alur permintaan peralatan: persetujuan dua pimpinan (seperti seragam), pilihan sumber anggaran, dan fungsi baca untuk web.
-- Sumber anggaran 'seragam': permintaan peralatan memakai anggaran seragam bagian KEAMANAN lokasi yang sama;
-- jual-nya ikut mengurangi sisa RAB seragam (lihat peralatan_terpakai_seragam).

alter table public.peralatan_lokasi
  add column if not exists seragam_lokasi_form text,                      -- lokasi_form di anggaran seragam (kosong = belum dipetakan)
  add column if not exists seragam_bagian text not null default 'KEAMANAN PRIA (SECURITY)';

-- pemetaan otomatis bila nama sama persis dengan lokasi seragam
update public.peralatan_lokasi l set seragam_lokasi_form = a.lokasi_form
  from (select distinct lokasi_form from public.anggaran_publik) a
  where l.seragam_lokasi_form is null and upper(trim(a.lokasi_form)) = upper(trim(l.nama));

alter table public.peralatan_permintaan
  add column if not exists status_yasir text, add column if not exists status_ferry text,
  add column if not exists token_yasir text, add column if not exists token_ferry text,
  add column if not exists diputuskan timestamptz,
  add column if not exists diputuskan_yasir timestamptz, add column if not exists diputuskan_ferry timestamptz,
  add column if not exists alasan_yasir text, add column if not exists alasan_ferry text,
  add column if not exists terkirim_yasir boolean, add column if not exists terkirim_ferry boolean,
  add column if not exists memo text;

-- ---------- fungsi baca (terbuka, tanpa token dan tanpa nama karyawan) ----------
create or replace function public.peralatan_daftar_lokasi()
 returns table(id bigint, nama text, bagian text, anggota int, kontrak_bulan int, rab numeric, terpakai numeric,
               seragam_lokasi_form text, seragam_bagian text, seragam_rab numeric, seragam_terpakai numeric, dari_sumber boolean, catatan text)
 language sql security definer set search_path to 'public' as $f$
  select l.id, l.nama, l.bagian, l.anggota, l.kontrak_bulan, l.rab,
         coalesce((select sum(p.total_jual) from public.peralatan_permintaan p where p.lokasi_id = l.id and p.sumber_anggaran = 'peralatan' and p.status <> 'ditolak'), 0),
         l.seragam_lokasi_form, l.seragam_bagian,
         (select a.anggaran from public.anggaran_publik a where a.lokasi_form = l.seragam_lokasi_form and a.bagian_kerja = l.seragam_bagian limit 1)::numeric,
         case when l.seragam_lokasi_form is null then null else
           coalesce((select sum(s.total_jual) from public.permintaan s where s.lokasi_form = l.seragam_lokasi_form and s.bagian_kerja = l.seragam_bagian and s.status is distinct from 'ditolak'), 0)
         + coalesce((select sum(p.total_jual) from public.peralatan_permintaan p join public.peralatan_lokasi l2 on l2.id = p.lokasi_id
                     where l2.seragam_lokasi_form = l.seragam_lokasi_form and l2.seragam_bagian = l.seragam_bagian and p.sumber_anggaran = 'seragam' and p.status <> 'ditolak'), 0) end,
         l.dari_sumber, l.catatan
  from public.peralatan_lokasi l where l.aktif order by l.nama $f$;
revoke all on function public.peralatan_daftar_lokasi() from public; grant execute on function public.peralatan_daftar_lokasi() to anon;

create or replace function public.peralatan_daftar_item()
 returns table(id bigint, nama text, harga_beli numeric, harga_jual numeric, perlu_ditinjau boolean)
 language sql security definer set search_path to 'public' as $f$
  select i.id, i.nama, i.harga_beli, i.harga_jual, i.perlu_ditinjau from public.peralatan_item i where i.aktif order by i.nama $f$;
revoke all on function public.peralatan_daftar_item() from public; grant execute on function public.peralatan_daftar_item() to anon;

create or replace function public.peralatan_daftar_permintaan()
 returns table(id bigint, dibuat timestamptz, tanggal timestamptz, lokasi_id bigint, lokasi text, sumber_anggaran text, rab numeric, anggota int,
               total_beli numeric, total_jual numeric, untung numeric, status text, status_yasir text, status_ferry text,
               diputuskan_yasir timestamptz, diputuskan_ferry timestamptz, alasan_yasir text, alasan_ferry text,
               terkirim_yasir boolean, terkirim_ferry boolean, memo text, asal text, catatan text, items jsonb)
 language sql security definer set search_path to 'public' as $f$
  select p.id, p.dibuat, p.tanggal, p.lokasi_id, l.nama, p.sumber_anggaran, p.rab, p.anggota, p.total_beli, p.total_jual, p.untung, p.status,
         p.status_yasir, p.status_ferry, p.diputuskan_yasir, p.diputuskan_ferry, p.alasan_yasir, p.alasan_ferry, p.terkirim_yasir, p.terkirim_ferry, p.memo, p.asal, p.catatan,
         coalesce((select jsonb_agg(jsonb_build_object('nama', i.nama, 'qty', i.qty, 'beli', i.harga_beli, 'jual', i.harga_jual) order by i.id)
                   from public.peralatan_permintaan_item i where i.permintaan_id = p.id), '[]'::jsonb)
  from public.peralatan_permintaan p join public.peralatan_lokasi l on l.id = p.lokasi_id
  order by p.dibuat desc, p.id desc limit 600 $f$;
revoke all on function public.peralatan_daftar_permintaan() from public; grant execute on function public.peralatan_daftar_permintaan() to anon;

-- jual permintaan peralatan yang memakai anggaran seragam, per lokasi + bagian seragam (dipakai halaman dan fungsi server seragam)
create or replace function public.peralatan_terpakai_seragam()
 returns table(lokasi_form text, bagian_kerja text, jual numeric)
 language sql security definer set search_path to 'public' as $f$
  select l.seragam_lokasi_form, l.seragam_bagian, sum(p.total_jual)
  from public.peralatan_permintaan p join public.peralatan_lokasi l on l.id = p.lokasi_id
  where p.sumber_anggaran = 'seragam' and p.status <> 'ditolak' and l.seragam_lokasi_form is not null
  group by 1, 2 $f$;
revoke all on function public.peralatan_terpakai_seragam() from public; grant execute on function public.peralatan_terpakai_seragam() to anon;

-- pemetaan manual (nama berbeda tapi jelas lokasi yang sama); periksa lagi bila ada yang keliru
update public.peralatan_lokasi l set seragam_lokasi_form = m.seragam
  from (values ('BPS WONOSOBO','BPS KABUPATEN WONOSOBO'), ('ESDM PURWOREJO','ESDM SERAYU SELATAN PURWOREJO'), ('HOMEWELL','PT HOMEWELL'), ('HSG','PT HSG KALIWUNGU'),
               ('LIEBRA PERMANA SEMARANG','PT. LIEBRA PERMANA SEMARANG'), ('LIEBRA PERMANA WONOGIRI','PT. LIEBRA PERMANA WONOGIRI'), ('RS ROEMANI','RS. ROEMANI SEMARANG'),
               ('RSJS','RSJS MAGELANG'), ('RSUD MERAH PUTIH','RSUD MERAH PUTIH MAGELANG'), ('STL MAGELANG','PT. STL MAGELANG'),
               ('TAICHANG','PT. TAICHANG WRAPPER INDONESIA'), ('UNZA VITALIS','PT. UNZA VITALIS')) as m(nama, seragam)
  where l.nama = m.nama and l.seragam_lokasi_form is null and exists (select 1 from public.anggaran_publik a where a.lokasi_form = m.seragam);
