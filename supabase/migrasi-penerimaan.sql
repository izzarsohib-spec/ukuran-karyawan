-- Penerimaan seragam di lokasi: form khusus penerima (tautan bertoken), berisi tanda tangan PIC dan penerima, foto dokumentasi,
-- dan status tiap baris (sesuai / kurang / rusak / salah ukuran). Mengisi form menandai pengiriman sebagai diterima.
alter table public.pengiriman add column if not exists token_terima text;

create table if not exists public.penerimaan (
  id bigint generated always as identity primary key,
  pengiriman_id bigint not null unique references public.pengiriman(id) on delete cascade,
  dibuat timestamptz not null default now(),
  tanggal_terima date not null,
  penerima text not null, jabatan_penerima text, pic_nama text,
  ttd_penerima_url text, ttd_pic_url text,
  foto_urls jsonb not null default '[]'::jsonb,
  catatan text, jumlah_sesuai int not null default 0, jumlah_masalah int not null default 0);
create table if not exists public.penerimaan_item (
  id bigint generated always as identity primary key,
  penerimaan_id bigint not null references public.penerimaan(id) on delete cascade,
  pengiriman_item_id bigint not null references public.pengiriman_item(id) on delete cascade,
  status text not null check (status in ('sesuai','kurang','rusak','salah_ukuran')),
  catatan text);
alter table public.penerimaan enable row level security;      revoke all on public.penerimaan from anon, authenticated;
alter table public.penerimaan_item enable row level security; revoke all on public.penerimaan_item from anon, authenticated;

-- admin: buat (atau ambil) token tautan form penerima untuk satu pengiriman
create or replace function public.buat_tautan_penerimaan(kode text, p_pengiriman bigint) returns text
 language plpgsql security definer set search_path to 'public' as $f$
declare tk text;
begin
  perform public._wajib_kode(kode);
  if not exists (select 1 from public.pengiriman where id = p_pengiriman) then raise exception 'pengiriman tidak ditemukan'; end if;
  update public.pengiriman set token_terima = coalesce(token_terima, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
   where id = p_pengiriman returning token_terima into tk;
  return tk;
end $f$;
revoke all on function public.buat_tautan_penerimaan(text, bigint) from public; grant execute on function public.buat_tautan_penerimaan(text, bigint) to anon, authenticated;

-- ringkasan penerimaan per pengiriman (tanpa nama karyawan dan tanpa token)
create or replace function public.daftar_penerimaan_ringkas()
 returns table(pengiriman_id bigint, ada_tautan boolean, penerima text, tanggal_terima date, jumlah_foto int, jumlah_masalah int, jumlah_sesuai int)
 language sql stable security definer set search_path to 'public' as $f$
  select g.id, g.token_terima is not null, n.penerima, n.tanggal_terima, coalesce(jsonb_array_length(n.foto_urls), 0), coalesce(n.jumlah_masalah, 0), coalesce(n.jumlah_sesuai, 0)
  from public.pengiriman g left join public.penerimaan n on n.pengiriman_id = g.id $f$;
revoke all on function public.daftar_penerimaan_ringkas() from public; grant execute on function public.daftar_penerimaan_ringkas() to anon;

-- admin: detail lengkap penerimaan (untuk berita acara PDF)
create or replace function public.detail_penerimaan(kode text, p_pengiriman bigint) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
declare r jsonb;
begin
  perform public._wajib_kode(kode);
  select jsonb_build_object('penerima', n.penerima, 'jabatan', n.jabatan_penerima, 'pic_nama', n.pic_nama, 'tanggal_terima', n.tanggal_terima, 'ttd_penerima', n.ttd_penerima_url, 'ttd_pic', n.ttd_pic_url,
    'foto', n.foto_urls, 'catatan', n.catatan, 'dibuat', n.dibuat,
    'item', coalesce((select jsonb_agg(jsonb_build_object('id', i.pengiriman_item_id, 'status', i.status, 'catatan', i.catatan, 'nama', p.nama, 'item_nama', p.item_nama, 'qty', p.qty, 'ukuran_baju', p.ukuran_baju, 'ukuran_celana', p.ukuran_celana, 'ukuran_sepatu', p.ukuran_sepatu) order by p.nama, p.item_no) from public.penerimaan_item i join public.pengiriman_item p on p.id = i.pengiriman_item_id where i.penerimaan_id = n.id), '[]'::jsonb))
    into r from public.penerimaan n where n.pengiriman_id = p_pengiriman;
  return r;
end $f$;
revoke all on function public.detail_penerimaan(text, bigint) from public; grant execute on function public.detail_penerimaan(text, bigint) to anon, authenticated;
