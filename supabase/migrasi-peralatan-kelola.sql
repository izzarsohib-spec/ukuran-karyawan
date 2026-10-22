-- Kelola data induk PERALATAN dari web: tambah / ubah lokasi (kontrak baru, perubahan RAB, anggota, pemetaan anggaran seragam) dan
-- tambah / ubah peralatan beserta harganya. Penulisan butuh kode akses (sama dengan modul seragam). Harga di permintaan lama tidak berubah
-- karena tiap permintaan menyimpan harga saat dibuat.

-- ---------- fungsi baca (tanpa nama karyawan; sama sifatnya dengan fungsi daftar yang sudah terbuka) ----------
create or replace function public.peralatan_kelola_lokasi()
 returns table(id bigint, nama text, bagian text, anggota int, kontrak_bulan int, anggaran_per_orang numeric, rab numeric, seragam_lokasi_form text, aktif boolean, dari_sumber boolean, jumlah_permintaan int)
 language sql security definer set search_path to 'public' as $f$
  select l.id, l.nama, l.bagian, l.anggota, l.kontrak_bulan, l.anggaran_per_orang, l.rab, l.seragam_lokasi_form, l.aktif, l.dari_sumber,
         (select count(*)::int from public.peralatan_permintaan p where p.lokasi_id = l.id)
  from public.peralatan_lokasi l order by l.nama $f$;
revoke all on function public.peralatan_kelola_lokasi() from public; grant execute on function public.peralatan_kelola_lokasi() to anon;

create or replace function public.peralatan_kelola_item()
 returns table(id bigint, nama text, harga_beli numeric, harga_jual numeric, aktif boolean, perlu_ditinjau boolean, dipakai int)
 language sql security definer set search_path to 'public' as $f$
  select i.id, i.nama, i.harga_beli, i.harga_jual, i.aktif, i.perlu_ditinjau,
         (select count(*)::int from public.peralatan_permintaan_item x where x.item_id = i.id)
  from public.peralatan_item i order by i.nama $f$;
revoke all on function public.peralatan_kelola_item() from public; grant execute on function public.peralatan_kelola_item() to anon;

create or replace function public.peralatan_daftar_seragam()
 returns table(lokasi_form text)
 language sql security definer set search_path to 'public' as $f$
  select distinct a.lokasi_form from public.anggaran_publik a order by 1 $f$;
revoke all on function public.peralatan_daftar_seragam() from public; grant execute on function public.peralatan_daftar_seragam() to anon;

-- ---------- fungsi tulis (kode akses) ----------
-- p_id kosong = lokasi baru (kontrak baru); terisi = ubah lokasi itu
create or replace function public.peralatan_simpan_lokasi(kode text, p_id bigint, p_nama text, p_bagian text, p_anggota int, p_kontrak int, p_per_orang numeric, p_rab numeric, p_seragam text, p_aktif boolean) returns bigint
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); b text := upper(trim(coalesce(nullif(trim(p_bagian),''),'KEAMANAN'))); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama lokasi wajib diisi'; end if;
  if coalesce(p_rab,0) < 0 then raise exception 'RAB tidak boleh negatif'; end if;
  if p_anggota is not null and p_anggota < 0 then raise exception 'jumlah anggota tidak valid'; end if;
  if p_kontrak is not null and (p_kontrak < 1 or p_kontrak > 60) then raise exception 'lama kontrak harus 1 sampai 60 bulan'; end if;
  if coalesce(p_seragam,'') <> '' and not exists (select 1 from public.anggaran_publik a where a.lokasi_form = p_seragam) then raise exception 'lokasi anggaran seragam tidak dikenal'; end if;
  if p_id is null then
    insert into public.peralatan_lokasi (nama, bagian, anggota, kontrak_bulan, anggaran_per_orang, rab, seragam_lokasi_form, dari_sumber, aktif)
      values (n, b, p_anggota, coalesce(p_kontrak,12), p_per_orang, coalesce(p_rab,0), nullif(p_seragam,''), false, true) returning id into rid;
  else
    update public.peralatan_lokasi set nama = n, bagian = b, anggota = p_anggota, kontrak_bulan = coalesce(p_kontrak, kontrak_bulan), anggaran_per_orang = p_per_orang,
      rab = coalesce(p_rab,0), seragam_lokasi_form = nullif(p_seragam,''), aktif = coalesce(p_aktif, aktif) where id = p_id returning id into rid;
    if rid is null then raise exception 'lokasi tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'lokasi dengan nama dan bagian itu sudah ada';
end $f$;
revoke all on function public.peralatan_simpan_lokasi(text,bigint,text,text,int,int,numeric,numeric,text,boolean) from public; grant execute on function public.peralatan_simpan_lokasi(text,bigint,text,text,int,int,numeric,numeric,text,boolean) to anon;

create or replace function public.peralatan_simpan_item(kode text, p_id bigint, p_nama text, p_beli numeric, p_jual numeric, p_aktif boolean) returns bigint
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare n text := upper(regexp_replace(trim(coalesce(p_nama,'')), '\s+', ' ', 'g')); rid bigint;
begin
  perform public._wajib_kode(kode);
  if n = '' then raise exception 'nama peralatan wajib diisi'; end if;
  if p_beli is null or p_jual is null or p_beli < 0 or p_jual < 0 then raise exception 'harga beli dan harga jual wajib diisi (tidak boleh negatif)'; end if;
  if p_id is null then
    insert into public.peralatan_item (nama, harga_beli, harga_jual, aktif, perlu_ditinjau) values (n, p_beli, p_jual, true, false) returning id into rid;
  else
    update public.peralatan_item set nama = n, harga_beli = p_beli, harga_jual = p_jual, aktif = coalesce(p_aktif, aktif), perlu_ditinjau = false where id = p_id returning id into rid;
    if rid is null then raise exception 'peralatan tidak ditemukan'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'peralatan dengan nama itu sudah ada';
end $f$;
revoke all on function public.peralatan_simpan_item(text,bigint,text,numeric,numeric,boolean) from public; grant execute on function public.peralatan_simpan_item(text,bigint,text,numeric,numeric,boolean) to anon;
