-- Tagihan = invoice dari vendor Wahyu Ardianto kepada kita (pembayaran ke vendor), bukan tagihan ke client.
-- Harga memakai HARGA BELI; aksesoris dikecualikan karena dipesan online, bukan ke Wahyu Ardianto.
-- Tagihan yang sudah dibuat sebelumnya (harga jual) tidak diubah; batalkan lalu buat ulang bila perlu.
create or replace function public.buat_tagihan(kode text, p_permintaan bigint, p_tanggal date, p_jatuh_tempo date, p_catatan text) returns jsonb
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r public.permintaan%rowtype; v_ploting bigint; v_kirim bigint; v_id bigint; v_no text; v_seq int; v_baris int;
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where permintaan.id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  perform pg_advisory_xact_lock(7102);
  select coalesce(sum(p.qty),0) into v_ploting from public.ploting p where p.permintaan_id = p_permintaan;
  select coalesce(sum(pi.qty),0) into v_kirim from public.pengiriman_item pi join public.pengiriman g on g.id = pi.pengiriman_id where g.permintaan_id = p_permintaan;
  if v_ploting = 0 or v_kirim < v_ploting then raise exception 'pengiriman belum selesai (% dari % pcs terkirim)', v_kirim, v_ploting; end if;
  if exists (select 1 from public.tagihan t where t.permintaan_id = p_permintaan and t.status <> 'batal') then raise exception 'tagihan untuk permintaan ini sudah ada'; end if;
  select count(*) + 1 into v_seq from public.tagihan where date_trunc('month', dibuat) = date_trunc('month', now());
  v_no := 'INV/' || to_char(now(),'YYYY/MM') || '/' || lpad(v_seq::text, 4, '0');
  insert into public.tagihan (no_invoice, tanggal, jatuh_tempo, permintaan_id, lokasi_form, client, bagian_kerja, catatan)
    values (v_no, coalesce(p_tanggal, current_date), p_jatuh_tempo, r.id, r.lokasi_form, r.client, r.bagian_kerja, left(p_catatan,300)) returning tagihan.id into v_id;
  insert into public.tagihan_item (tagihan_id, item_no, item_nama, qty, harga, subtotal)
    select v_id, a.item_no, a.nama, a.q, h.p, a.q * h.p
    from (select pi.item_no, max(pi.item_nama) as nama, sum(pi.qty)::int as q from public.pengiriman_item pi join public.pengiriman g on g.id = pi.pengiriman_id
          where g.permintaan_id = p_permintaan group by pi.item_no) a
    join public.harga_seragam hs on hs.no = a.item_no and hs.kategori <> 'Aksesoris'
    cross join lateral (select coalesce((select (i->>'beli')::bigint from jsonb_array_elements(r.items) i where (i->>'no')::int = a.item_no limit 1), hs.harga_beli, 0)::bigint as p) h;
  get diagnostics v_baris = row_count;
  if v_baris = 0 then raise exception 'tidak ada barang dari vendor Wahyu Ardianto untuk ditagih (aksesoris dipesan online)'; end if;
  update public.tagihan t set total = (select coalesce(sum(ti.subtotal),0) from public.tagihan_item ti where ti.tagihan_id = v_id) where t.id = v_id;
  return jsonb_build_object('id', v_id, 'no_invoice', v_no);
end $f$;
revoke all on function public.buat_tagihan(text,bigint,date,date,text) from public; grant execute on function public.buat_tagihan(text,bigint,date,date,text) to anon;
