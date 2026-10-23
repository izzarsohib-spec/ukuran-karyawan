-- Pelacakan aksesoris (dipesan online): dipesan (permintaan disetujui kedua pimpinan, PO ditandai terkirim) dibanding diterima dari supplier "Online".
create or replace function public.kekurangan_aksesoris(kode text)
 returns table(item_no int, item_nama text, dipesan bigint, diterima bigint)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query
    with pesan as (
      select (e->>'no')::int as no, sum((e->>'qty')::int)::bigint as q
      from public.permintaan p, jsonb_array_elements(p.items) e
      where p.po_dikirim is not null and coalesce(p.status_yasir, p.status, 'menunggu') = 'disetujui' and coalesce(p.status_ferry, p.status, 'menunggu') = 'disetujui'
        and (e->>'no') ~ '^\d+$' group by 1),
    terima as (
      select s.item_no, sum(case when s.jenis = 'masuk' then s.qty else -s.qty end)::bigint as q
      from public.stok_gerak s
      where lower(btrim(coalesce(s.supplier, ''))) = 'online' and ((s.jenis = 'masuk' and s.sumber is null) or (s.jenis = 'keluar' and s.sumber = 'retur'))
      group by 1)
    select h.no, h.nama, p.q, coalesce(t.q, 0)
    from pesan p join public.harga_seragam h on h.no = p.no and h.komponen = 'aksesoris'
    left join terima t on t.item_no = p.no order by h.no;
end $f$;
revoke all on function public.kekurangan_aksesoris(text) from public; grant execute on function public.kekurangan_aksesoris(text) to anon, authenticated;
