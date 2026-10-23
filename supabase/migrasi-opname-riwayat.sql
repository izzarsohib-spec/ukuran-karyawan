-- Stock opname: alasan selisih per baris + data rinci semua baris yang dihitung (untuk riwayat kekurangan/kelebihan per barang).
alter table public.opname_item add column if not exists alasan text;

-- p_baris: [{item_no, jenis_ukuran, ukuran, fisik, alasan?}]
create or replace function public.simpan_opname(kode text, p_tanggal date, p_catatan text, p_baris jsonb) returns jsonb
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare v_id bigint; v_tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date); v_baris int; v_sel int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada baris opname'; end if;
  perform pg_advisory_xact_lock(7101);
  create temp table _op on commit drop as
    select (b->>'item_no')::int as item_no, h.nama as item_nama, b->>'jenis_ukuran' as jenis_ukuran, coalesce(nullif(b->>'ukuran',''),'-') as ukuran, (b->>'fisik')::int as fisik,
           coalesce(s.saldo,0)::int as sistem, left(nullif(btrim(b->>'alasan'), ''), 120) as alasan
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int
    left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo from public.stok_gerak g group by 1,2,3) s
      on s.item_no = (b->>'item_no')::int and s.jenis_ukuran = (b->>'jenis_ukuran') and s.ukuran = coalesce(nullif(b->>'ukuran',''),'-');
  if (select count(*) from _op) <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  if exists (select 1 from _op where fisik < 0) then raise exception 'jumlah fisik tidak boleh negatif'; end if;
  select count(*), count(*) filter (where fisik <> sistem) into v_baris, v_sel from _op;
  insert into public.opname (tanggal, catatan, jumlah_baris, jumlah_selisih) values (v_tgl, left(p_catatan,300), v_baris, v_sel) returning opname.id into v_id;
  insert into public.opname_item (opname_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, selisih, alasan)
    select v_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, fisik - sistem, case when fisik <> sistem then alasan end from _op;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, no_dokumen, keterangan, sumber)
    select v_tgl, case when fisik > sistem then 'masuk' else 'keluar' end, item_no, item_nama, jenis_ukuran, ukuran, abs(fisik - sistem),
           'OPNAME-' || v_id, 'Penyesuaian stock opname (sistem ' || sistem || ', fisik ' || fisik || ')' || coalesce(' - ' || alasan, ''), 'opname'
    from _op where fisik <> sistem;
  return jsonb_build_object('id', v_id, 'baris', v_baris, 'selisih', v_sel);
end $f$;
revoke all on function public.simpan_opname(text,date,text,jsonb) from public;
grant execute on function public.simpan_opname(text,date,text,jsonb) to anon;

-- semua baris yang pernah dihitung (termasuk yang cocok), 2000 baris terbaru
create or replace function public.daftar_opname_rinci()
 returns table(opname_id bigint, tanggal date, catatan text, item_no int, item_nama text, jenis_ukuran text, ukuran text, sistem int, fisik int, selisih int, alasan text)
 language sql stable security definer set search_path to 'public' as $f$
  select o.id, o.tanggal, o.catatan, i.item_no, i.item_nama, i.jenis_ukuran, i.ukuran, i.sistem, i.fisik, i.selisih, i.alasan
  from public.opname_item i join public.opname o on o.id = i.opname_id order by o.tanggal desc, o.id desc, i.item_no, i.ukuran limit 2000 $f$;
revoke all on function public.daftar_opname_rinci() from public; grant execute on function public.daftar_opname_rinci() to anon;
