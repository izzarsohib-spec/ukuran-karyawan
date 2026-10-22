-- Surat permintaan (memo, PO, daftar harga, RAB) untuk peralatan: tautan halaman surat disimpan di permintaan.
alter table public.peralatan_permintaan add column if not exists lampiran_url text;

drop function if exists public.peralatan_daftar_permintaan();
create function public.peralatan_daftar_permintaan()
 returns table(id bigint, dibuat timestamptz, tanggal timestamptz, lokasi_id bigint, lokasi text, sumber_anggaran text, rab numeric, anggota int,
               total_beli numeric, total_jual numeric, untung numeric, status text, status_yasir text, status_ferry text,
               diputuskan_yasir timestamptz, diputuskan_ferry timestamptz, alasan_yasir text, alasan_ferry text,
               terkirim_yasir boolean, terkirim_ferry boolean, memo text, asal text, catatan text, tahap text, beli_aktual numeric, items jsonb, belanja jsonb, pengiriman jsonb, lampiran_url text)
 language sql security definer set search_path to 'public' as $f$
  select p.id, p.dibuat, p.tanggal, p.lokasi_id, l.nama, p.sumber_anggaran, p.rab, p.anggota, p.total_beli, p.total_jual, p.untung, p.status,
         p.status_yasir, p.status_ferry, p.diputuskan_yasir, p.diputuskan_ferry, p.alasan_yasir, p.alasan_ferry, p.terkirim_yasir, p.terkirim_ferry, p.memo, p.asal, p.catatan, p.tahap,
         coalesce((select sum(b.qty * b.harga_satuan) from public.peralatan_belanja b where b.permintaan_id = p.id), 0),
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nama', i.nama, 'qty', i.qty, 'beli', i.harga_beli, 'jual', i.harga_jual,
                     'dibeli', coalesce((select sum(b.qty) from public.peralatan_belanja b where b.permintaan_item_id = i.id), 0),
                     'terkirim', coalesce((select sum(k.qty) from public.peralatan_pengiriman_item k where k.permintaan_item_id = i.id), 0)) order by i.id)
                   from public.peralatan_permintaan_item i where i.permintaan_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'tanggal', b.tanggal, 'nama', i.nama, 'qty', b.qty, 'harga', b.harga_satuan, 'tempat', b.tempat, 'toko', b.toko, 'catatan', b.catatan) order by b.tanggal, b.id)
                   from public.peralatan_belanja b join public.peralatan_permintaan_item i on i.id = b.permintaan_item_id where b.permintaan_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'tanggal', k.tanggal, 'kurir', k.kurir, 'resi', k.resi, 'penerima', k.penerima, 'catatan', k.catatan, 'diterima', k.diterima,
                     'items', (select jsonb_agg(jsonb_build_object('nama', i.nama, 'qty', ki.qty) order by ki.id) from public.peralatan_pengiriman_item ki join public.peralatan_permintaan_item i on i.id = ki.permintaan_item_id where ki.pengiriman_id = k.id)) order by k.tanggal, k.id)
                   from public.peralatan_pengiriman k where k.permintaan_id = p.id), '[]'::jsonb),
         p.lampiran_url
  from public.peralatan_permintaan p join public.peralatan_lokasi l on l.id = p.lokasi_id
  order by p.dibuat desc, p.id desc limit 600 $f$;
revoke all on function public.peralatan_daftar_permintaan() from public; grant execute on function public.peralatan_daftar_permintaan() to anon;

