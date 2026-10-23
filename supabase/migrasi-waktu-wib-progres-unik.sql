-- Tanggal 'hari ini' memakai WIB (bukan UTC) agar pencatatan antara 00.00-07.00 WIB tidak mundur sehari.
CREATE OR REPLACE FUNCTION public.catat_barang_masuk(kode text, p_tanggal date, p_supplier text, p_no_dokumen text, p_keterangan text, p_baris jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare n int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dimasukkan'; end if;
  if coalesce(trim(p_supplier),'') = '' then raise exception 'nama supplier wajib diisi'; end if;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, supplier, no_dokumen, keterangan)
    select coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), 'masuk', (b->>'item_no')::int, h.nama, coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'),
           (b->>'qty')::int, left(trim(p_supplier),120), left(p_no_dokumen,80), left(p_keterangan,300)
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.catat_pengiriman(kode text, p_permintaan bigint, p_tanggal date, p_ekspedisi text, p_resi text, p_penerima text, p_keterangan text, p_ploting_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r public.permintaan%rowtype; v_id bigint; v_no text; v_seq int; v_kurang text; v_tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where permintaan.id = p_permintaan;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if coalesce(array_length(p_ploting_ids,1),0) = 0 then raise exception 'tidak ada barang yang dipilih'; end if;
  perform pg_advisory_xact_lock(7101);
  if exists (select 1 from unnest(p_ploting_ids) i left join public.ploting p on p.id = i where p.id is null or p.permintaan_id <> p_permintaan) then
    raise exception 'ada baris ploting yang tidak valid';
  end if;
  if exists (select 1 from public.pengiriman_item pi where pi.ploting_id = any(p_ploting_ids)) then
    raise exception 'ada barang yang sudah pernah dikirim';
  end if;
  create temp table _butuh on commit drop as
    select u.item_no, max(u.item_nama) as item_nama, u.jenis, u.ukuran, sum(u.qty)::int as q from (
      select p.item_no, p.item_nama, 'baju'::text as jenis, p.ukuran_baju as ukuran, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_baju is not null
      union all select p.item_no, p.item_nama, 'celana', p.ukuran_celana, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_celana is not null
      union all select p.item_no, p.item_nama, 'sepatu', p.ukuran_sepatu, p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_sepatu is not null
      union all select p.item_no, p.item_nama, '-', '-', p.qty from public.ploting p where p.id = any(p_ploting_ids) and p.ukuran_baju is null and p.ukuran_celana is null and p.ukuran_sepatu is null
    ) u group by u.item_no, u.jenis, u.ukuran;
  select string_agg(b.item_nama || ' ' || b.jenis || ' ' || b.ukuran || ' (butuh ' || b.q || ', stok ' || coalesce(s.saldo,0) || ')', '; ') into v_kurang
  from _butuh b left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo
                           from public.stok_gerak g group by 1,2,3) s on s.item_no = b.item_no and s.jenis_ukuran = b.jenis and s.ukuran = b.ukuran
  where coalesce(s.saldo,0) < b.q;
  if v_kurang is not null then raise exception 'stok tidak cukup: %', v_kurang; end if;
  select count(*) + 1 into v_seq from public.pengiriman where date_trunc('month', dibuat) = date_trunc('month', now());
  v_no := 'SJ/' || to_char(now(),'YYYY/MM') || '/' || lpad(v_seq::text, 4, '0');
  insert into public.pengiriman (tanggal, no_surat_jalan, permintaan_id, lokasi_form, client, bagian_kerja, ekspedisi, no_resi, penerima, keterangan)
    values (v_tgl, v_no, r.id, r.lokasi_form, r.client, r.bagian_kerja, left(p_ekspedisi,100), left(p_resi,100), left(p_penerima,150), left(p_keterangan,300))
    returning pengiriman.id into v_id;
  insert into public.pengiriman_item (pengiriman_id, ploting_id, nama, item_no, item_nama, qty, ukuran_baju, ukuran_celana, ukuran_sepatu)
    select v_id, p.id, p.nama, p.item_no, p.item_nama, p.qty, p.ukuran_baju, p.ukuran_celana, p.ukuran_sepatu from public.ploting p where p.id = any(p_ploting_ids);
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, no_dokumen, pengiriman_id)
    select v_tgl, 'keluar', b.item_no, b.item_nama, b.jenis, b.ukuran, b.q, v_no, v_id from _butuh b;
  return jsonb_build_object('id', v_id, 'no_surat_jalan', v_no);
end $function$
;
CREATE OR REPLACE FUNCTION public.buat_tagihan(kode text, p_permintaan bigint, p_tanggal date, p_jatuh_tempo date, p_catatan text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    values (v_no, coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), p_jatuh_tempo, r.id, r.lokasi_form, r.client, r.bagian_kerja, left(p_catatan,300)) returning tagihan.id into v_id;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.catat_bayar(kode text, p_tagihan bigint, p_tanggal date, p_jumlah bigint, p_keterangan text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare t public.tagihan%rowtype; baru bigint;
begin
  perform public._wajib_kode(kode);
  select * into t from public.tagihan where id = p_tagihan for update;
  if not found then raise exception 'tagihan tidak ditemukan'; end if;
  if t.status = 'batal' then raise exception 'tagihan sudah dibatalkan'; end if;
  if coalesce(p_jumlah,0) <= 0 then raise exception 'jumlah pembayaran harus lebih dari 0'; end if;
  if t.terbayar + p_jumlah > t.total then raise exception 'pembayaran melebihi sisa tagihan (sisa %)', t.total - t.terbayar; end if;
  insert into public.tagihan_bayar (tagihan_id, tanggal, jumlah, keterangan) values (p_tagihan, coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), p_jumlah, left(p_keterangan,200));
  baru := t.terbayar + p_jumlah;
  update public.tagihan set terbayar = baru, status = case when baru >= total then 'lunas' when baru > 0 then 'sebagian' else 'belum' end where id = p_tagihan;
end $function$
;
CREATE OR REPLACE FUNCTION public.catat_retur(kode text, p_tanggal date, p_arah text, p_pengiriman bigint, p_supplier text, p_alasan text, p_baris jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare n int; v_sj text; v_kurang text;
begin
  perform public._wajib_kode(kode);
  if p_arah not in ('dari_lokasi','ke_supplier') then raise exception 'arah retur tidak dikenal'; end if;
  if coalesce(trim(p_alasan),'') = '' then raise exception 'alasan retur wajib diisi'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang diretur'; end if;
  perform pg_advisory_xact_lock(7101);
  if p_arah = 'ke_supplier' then
    if coalesce(trim(p_supplier),'') = '' then raise exception 'nama supplier wajib diisi'; end if;
    select string_agg(h.nama || ' ' || (b->>'jenis_ukuran') || ' ' || coalesce(nullif(b->>'ukuran',''),'-') || ' (retur ' || (b->>'qty') || ', stok ' || coalesce(s.saldo,0) || ')', '; ') into v_kurang
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int
    left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo from public.stok_gerak g group by 1,2,3) s
      on s.item_no = (b->>'item_no')::int and s.jenis_ukuran = (b->>'jenis_ukuran') and s.ukuran = coalesce(nullif(b->>'ukuran',''),'-')
    where coalesce(s.saldo,0) < (b->>'qty')::int;
    if v_kurang is not null then raise exception 'stok tidak cukup untuk diretur: %', v_kurang; end if;
  else
    if p_pengiriman is not null then
      select no_surat_jalan into v_sj from public.pengiriman where id = p_pengiriman;
      if not found then raise exception 'pengiriman asal tidak ditemukan'; end if;
    end if;
  end if;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, supplier, no_dokumen, keterangan, pengiriman_id, sumber)
    select coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), case when p_arah = 'dari_lokasi' then 'masuk' else 'keluar' end, (b->>'item_no')::int, h.nama,
           coalesce(nullif(b->>'jenis_ukuran',''),'-'), coalesce(nullif(b->>'ukuran',''),'-'), (b->>'qty')::int,
           case when p_arah = 'ke_supplier' then left(trim(p_supplier),120) end, v_sj,
           left((case when p_arah = 'dari_lokasi' then 'Retur dari lokasi: ' else 'Retur ke supplier: ' end) || trim(p_alasan), 300),
           case when p_arah = 'dari_lokasi' then p_pengiriman end, 'retur'
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.peralatan_catat_belanja(kode text, p_id bigint, p_tanggal date, p_tempat text, p_toko text, p_catatan text, p_baris jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r record; b jsonb; it record; sudah int; n int := 0;
begin
  perform public._wajib_kode(kode);
  select * into r from public.peralatan_permintaan where id = p_id;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if p_tempat not in ('online','wahyu','lain') then raise exception 'tempat belanja tidak valid'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dicatat'; end if;
  for b in select * from jsonb_array_elements(p_baris) loop
    select * into it from public.peralatan_permintaan_item where id = (b->>'item')::bigint and permintaan_id = p_id;
    if not found then raise exception 'item bukan bagian dari permintaan ini'; end if;
    if (b->>'qty')::int < 1 or (b->>'harga')::numeric < 0 then raise exception 'qty atau harga tidak valid'; end if;
    select coalesce(sum(qty),0) into sudah from public.peralatan_belanja where permintaan_item_id = it.id;
    if sudah + (b->>'qty')::int > it.qty then raise exception 'belanja % melebihi yang diminta (% dari %)', it.nama, sudah + (b->>'qty')::int, it.qty; end if;
    insert into public.peralatan_belanja (tanggal, permintaan_id, permintaan_item_id, qty, harga_satuan, tempat, toko, catatan)
      values (coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), p_id, it.id, (b->>'qty')::int, (b->>'harga')::numeric, p_tempat, nullif(trim(p_toko),''), nullif(trim(p_catatan),''));
    n := n + 1;
  end loop;
  if r.tahap = 'belum' then update public.peralatan_permintaan set tahap = 'dibelanjakan' where id = p_id; end if;
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION public.simpan_opname(kode text, p_tanggal date, p_catatan text, p_baris jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_id bigint; v_tgl date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date); v_baris int; v_sel int;
begin
  perform public._wajib_kode(kode);
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada baris opname'; end if;
  perform pg_advisory_xact_lock(7101);
  create temp table _op on commit drop as
    select (b->>'item_no')::int as item_no, h.nama as item_nama, b->>'jenis_ukuran' as jenis_ukuran, coalesce(nullif(b->>'ukuran',''),'-') as ukuran, (b->>'fisik')::int as fisik,
           coalesce(s.saldo,0)::int as sistem
    from jsonb_array_elements(p_baris) b join public.harga_seragam h on h.no = (b->>'item_no')::int
    left join (select g.item_no, g.jenis_ukuran, g.ukuran, sum(case when g.jenis='masuk' then g.qty else -g.qty end) as saldo from public.stok_gerak g group by 1,2,3) s
      on s.item_no = (b->>'item_no')::int and s.jenis_ukuran = (b->>'jenis_ukuran') and s.ukuran = coalesce(nullif(b->>'ukuran',''),'-');
  if (select count(*) from _op) <> jsonb_array_length(p_baris) then raise exception 'ada item yang tidak dikenal'; end if;
  if exists (select 1 from _op where fisik < 0) then raise exception 'jumlah fisik tidak boleh negatif'; end if;
  select count(*), count(*) filter (where fisik <> sistem) into v_baris, v_sel from _op;
  insert into public.opname (tanggal, catatan, jumlah_baris, jumlah_selisih) values (v_tgl, left(p_catatan,300), v_baris, v_sel) returning opname.id into v_id;
  insert into public.opname_item (opname_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, selisih)
    select v_id, item_no, item_nama, jenis_ukuran, ukuran, sistem, fisik, fisik - sistem from _op;
  insert into public.stok_gerak (tanggal, jenis, item_no, item_nama, jenis_ukuran, ukuran, qty, no_dokumen, keterangan, sumber)
    select v_tgl, case when fisik > sistem then 'masuk' else 'keluar' end, item_no, item_nama, jenis_ukuran, ukuran, abs(fisik - sistem),
           'OPNAME-' || v_id, 'Penyesuaian stock opname (sistem ' || sistem || ', fisik ' || fisik || ')', 'opname'
    from _op where fisik <> sistem;
  return jsonb_build_object('id', v_id, 'baris', v_baris, 'selisih', v_sel);
end $function$
;
CREATE OR REPLACE FUNCTION public.janji_simpan(kode text, p_vendor bigint, p_grup text, p_label text, p_qty integer, p_tgl date, p_catatan text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rid bigint;
begin
  perform public._wajib_kode(kode);
  if p_tgl is null then raise exception 'tanggal estimasi wajib diisi'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'jumlah yang diestimasi harus lebih dari 0'; end if;
  if not exists (select 1 from public.vendor where id = p_vendor) then raise exception 'vendor tidak ditemukan'; end if;
  update public.janji_vendor set status = 'diganti', ditutup_pada = now() where vendor_id = p_vendor and label = p_label and status = 'aktif';
  insert into public.janji_vendor (vendor_id, grup, label, qty, tgl_dicatat, tgl_janji, catatan)
    values (p_vendor, p_grup, left(p_label, 200), p_qty, (now() at time zone 'Asia/Jakarta')::date, p_tgl, nullif(trim(coalesce(p_catatan, '')), '')) returning id into rid;
  return rid;
end $function$
;
CREATE OR REPLACE FUNCTION public.peralatan_catat_kirim(kode text, p_id bigint, p_tanggal date, p_kurir text, p_resi text, p_penerima text, p_catatan text, p_baris jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r record; b jsonb; it record; dibeli int; terkirim int; kid bigint;
begin
  perform public._wajib_kode(kode);
  select * into r from public.peralatan_permintaan where id = p_id;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if r.status <> 'disetujui' then raise exception 'permintaan belum disetujui kedua pimpinan'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then raise exception 'tidak ada barang yang dikirim'; end if;
  insert into public.peralatan_pengiriman (tanggal, permintaan_id, kurir, resi, penerima, catatan)
    values (coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date), p_id, nullif(trim(p_kurir),''), nullif(trim(p_resi),''), nullif(trim(p_penerima),''), nullif(trim(p_catatan),'')) returning id into kid;
  for b in select * from jsonb_array_elements(p_baris) loop
    select * into it from public.peralatan_permintaan_item where id = (b->>'item')::bigint and permintaan_id = p_id;
    if not found then raise exception 'item bukan bagian dari permintaan ini'; end if;
    if (b->>'qty')::int < 1 then raise exception 'qty tidak valid'; end if;
    select coalesce(sum(qty),0) into dibeli from public.peralatan_belanja where permintaan_item_id = it.id;
    select coalesce(sum(qty),0) into terkirim from public.peralatan_pengiriman_item where permintaan_item_id = it.id;
    if terkirim + (b->>'qty')::int > dibeli then raise exception 'kirim % melebihi yang sudah dibeli (dibeli %, terkirim %)', it.nama, dibeli, terkirim; end if;
    insert into public.peralatan_pengiriman_item (pengiriman_id, permintaan_item_id, qty) values (kid, it.id, (b->>'qty')::int);
  end loop;
  update public.peralatan_permintaan set tahap = 'dikirim' where id = p_id and tahap in ('belum','dibelanjakan');
  return kid;
end $function$
;
CREATE OR REPLACE FUNCTION public.peralatan_tandai_diterima(kode text, p_kirim bigint, p_tanggal date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare pid bigint; sisa int; blm int;
begin
  perform public._wajib_kode(kode);
  update public.peralatan_pengiriman set diterima = coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date) where id = p_kirim returning permintaan_id into pid;
  if pid is null then raise exception 'pengiriman tidak ditemukan'; end if;
  select coalesce(sum(i.qty - coalesce((select sum(k.qty) from public.peralatan_pengiriman_item k where k.permintaan_item_id = i.id),0)),0) into sisa from public.peralatan_permintaan_item i where i.permintaan_id = pid;
  select count(*) into blm from public.peralatan_pengiriman where permintaan_id = pid and diterima is null;
  if sisa = 0 and blm = 0 then update public.peralatan_permintaan set tahap = 'diterima' where id = pid; return 'diterima'; end if;
  return 'dikirim';
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_status_karyawan(kode text, p_id bigint, p_aktif boolean, p_tanggal date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._wajib_kode(kode);
  update public.ukuran_pekerja set aktif = p_aktif, keluar_pada = case when p_aktif then null else coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date) end, diperbarui = now() where id = p_id;
  if not found then raise exception 'karyawan tidak ditemukan'; end if;
end $function$
;
alter table public.peralatan_belanja alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.peralatan_pengiriman alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.stok_gerak alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.pengiriman alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.tagihan alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.tagihan_bayar alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.opname alter column tanggal set default (now() at time zone 'Asia/Jakarta')::date;
alter table public.janji_vendor alter column tgl_dicatat set default (now() at time zone 'Asia/Jakarta')::date;
create or replace view public.progres_pengisian as
 select a.client, a.lokasi_form, a.bagian_kerja, a.jumlah_anggota as target,
   count(distinct upper(btrim(regexp_replace(u.nama, '\s+', ' ', 'g'))))::integer as sudah_isi
 from acuan_rekap a left join ukuran_pekerja u on u.lokasi = a.lokasi_form and u.bagian_kerja = a.bagian_kerja and u.aktif
 group by a.client, a.lokasi_form, a.bagian_kerja, a.jumlah_anggota;
