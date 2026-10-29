-- Penandaan jalur pemesanan per item: setiap item pada permintaan yang sudah disetujui kedua pimpinan ditandai
-- dipesan ke Mas Wahyu (vendor) atau Online. Dipakai halaman Rekap Permintaan.
-- Membaca terbuka (hanya jalur + tanggal, tanpa harga); menulis hanya admin (login).

create table if not exists public.pemesanan_item (
  permintaan_id bigint not null references public.permintaan(id) on delete cascade,
  item_no int not null,
  via text not null check (via in ('wahyu', 'online')),
  tanggal date not null default ((now() at time zone 'Asia/Jakarta')::date),
  dibuat timestamptz not null default now(),
  primary key (permintaan_id, item_no)
);
alter table public.pemesanan_item enable row level security;
revoke all on public.pemesanan_item from anon, authenticated;

create or replace function public.daftar_pemesanan()
 returns table(permintaan_id bigint, item_no int, via text, tanggal date)
 language sql stable security definer set search_path to 'public' as $f$
  select permintaan_id, item_no, via, tanggal from public.pemesanan_item $f$;
revoke all on function public.daftar_pemesanan() from public;
grant execute on function public.daftar_pemesanan() to anon, authenticated;

-- p_baris: [{permintaan_id, item_no, via ('wahyu'|'online'; kosong = hapus tanda), tanggal}]
create or replace function public.simpan_pemesanan(kode text, p_baris jsonb) returns int
 language plpgsql security definer set search_path to 'public' as $f$
declare n int := 0; b jsonb; v text; pid bigint; ino int; tgl date;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' then raise exception 'format tidak valid'; end if;
  for b in select * from jsonb_array_elements(p_baris) loop
    pid := (b->>'permintaan_id')::bigint; ino := (b->>'item_no')::int; v := coalesce(nullif(b->>'via', ''), '');
    tgl := coalesce(nullif(b->>'tanggal', '')::date, (now() at time zone 'Asia/Jakarta')::date);
    if tgl > (now() at time zone 'Asia/Jakarta')::date then raise exception 'tanggal pemesanan tidak boleh di masa depan'; end if;
    if v = '' then
      delete from public.pemesanan_item where permintaan_id = pid and item_no = ino;
    else
      if v not in ('wahyu', 'online') then raise exception 'jalur pemesanan tidak dikenal'; end if;
      if not exists (select 1 from public.permintaan p where p.id = pid and coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui') then
        raise exception 'permintaan % belum disetujui kedua pimpinan', pid;
      end if;
      insert into public.pemesanan_item (permintaan_id, item_no, via, tanggal) values (pid, ino, v, tgl)
        on conflict (permintaan_id, item_no) do update set via = excluded.via, tanggal = excluded.tanggal, dibuat = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $f$;
revoke all on function public.simpan_pemesanan(text, jsonb) from public;
grant execute on function public.simpan_pemesanan(text, jsonb) to anon, authenticated;

-- ukuran per permintaan untuk SEMUA permintaan yang disetujui kedua pimpinan (rekap_ukuran_antrean hanya yang PO-nya belum ditandai)
create or replace function public.rekap_ukuran_semua()
 returns table(permintaan_id bigint, lokasi_form text, bagian_kerja text, item_no int, item_nama text, jenis text, ukuran text, qty bigint)
 language sql stable security definer set search_path to 'public' as $f$
  select u.permintaan_id, u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran, sum(u.qty)::bigint
  from (
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'baju'::text as jenis, g.ukuran_baju as ukuran, g.qty from public.ploting g where g.ukuran_baju is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'celana', g.ukuran_celana, g.qty from public.ploting g where g.ukuran_celana is not null
    union all
    select g.permintaan_id, g.lokasi_form, g.bagian_kerja, g.item_no, g.item_nama, 'sepatu', g.ukuran_sepatu, g.qty from public.ploting g where g.ukuran_sepatu is not null
  ) u
  join public.permintaan p on p.id = u.permintaan_id
  where coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui'
  group by u.permintaan_id, u.lokasi_form, u.bagian_kerja, u.item_no, u.item_nama, u.jenis, u.ukuran $f$;
revoke all on function public.rekap_ukuran_semua() from public;
grant execute on function public.rekap_ukuran_semua() to anon, authenticated;
