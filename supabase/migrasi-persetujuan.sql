-- Persetujuan pimpinan: admin bisa menarik permintaan yang masih menunggu, dan pengingat harian ke pimpinan yang belum memutuskan.

-- Menarik permintaan yang belum disetujui kedua pimpinan: pimpinan yang masih "menunggu" ditandai ditolak dengan alasan "Ditarik admin",
-- sehingga seluruh sistem (RAB, cakupan, rekap, kekurangan vendor) memperlakukannya sebagai ditolak. Tautan notifikasi lama otomatis tidak berlaku.
create or replace function public.tarik_permintaan(kode text, p_id bigint, p_alasan text default null) returns void
 language plpgsql security definer set search_path to 'public','extensions' as $f$
declare r public.permintaan%rowtype; al text := 'Ditarik admin' || coalesce(': ' || nullif(left(trim(p_alasan), 300), ''), '');
begin
  perform public._wajib_kode(kode);
  select * into r from public.permintaan where id = p_id for update;
  if not found then raise exception 'permintaan tidak ditemukan'; end if;
  if coalesce(r.status_yasir, r.status, 'menunggu') = 'disetujui' and coalesce(r.status_ferry, r.status, 'menunggu') = 'disetujui' then
    raise exception 'permintaan sudah disetujui kedua pimpinan, tidak bisa ditarik';
  end if;
  if coalesce(r.status, 'menunggu') = 'ditolak' then raise exception 'permintaan sudah ditolak/ditarik'; end if;
  update public.permintaan set
    status = 'ditolak', diputuskan = now(),
    status_yasir = case when coalesce(status_yasir, 'menunggu') = 'menunggu' then 'ditolak' else status_yasir end,
    diputuskan_yasir = case when coalesce(status_yasir, 'menunggu') = 'menunggu' then now() else diputuskan_yasir end,
    alasan_yasir = case when coalesce(status_yasir, 'menunggu') = 'menunggu' then al else alasan_yasir end,
    status_ferry = case when coalesce(status_ferry, 'menunggu') = 'menunggu' then 'ditolak' else status_ferry end,
    diputuskan_ferry = case when coalesce(status_ferry, 'menunggu') = 'menunggu' then now() else diputuskan_ferry end,
    alasan_ferry = case when coalesce(status_ferry, 'menunggu') = 'menunggu' then al else alasan_ferry end
  where id = p_id;
end $f$;
revoke all on function public.tarik_permintaan(text,bigint,text) from public; grant execute on function public.tarik_permintaan(text,bigint,text) to anon, authenticated;

-- Pengingat harian 08.00 WIB (01.00 UTC): memanggil fungsi kirim-permintaan (aksi pengingat_pimpinan) dengan X-Token.
-- <N8N_TOKEN> diganti nilai rahasia sebenarnya saat diterapkan (jangan disimpan di repo).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.unschedule('pengingat-pimpinan') where exists (select 1 from cron.job where jobname = 'pengingat-pimpinan');
select cron.schedule('pengingat-pimpinan', '0 1 * * *', $c$
  select net.http_post(url := 'https://vqcusagijiavaoljfrib.supabase.co/functions/v1/kirim-permintaan',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Token', '<N8N_TOKEN>'),
    body := '{"pengingat_pimpinan": true}'::jsonb) $c$);
-- Dibuat NONAKTIF: nyalakan hanya saat sistem dipakai dengan data asli (pengingat ini mengirim ntfy sungguhan ke pimpinan):
--   select cron.alter_job((select jobid from cron.job where jobname = 'pengingat-pimpinan'), active := true);
select cron.alter_job((select jobid from cron.job where jobname = 'pengingat-pimpinan'), active := false);
