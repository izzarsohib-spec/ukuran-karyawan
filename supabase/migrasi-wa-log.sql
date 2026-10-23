-- Catatan hasil pengiriman WhatsApp (pengingat PIC dan vendor) supaya kegagalan terlihat, tidak diam-diam.
-- Ditulis oleh fungsi server (service_role): ingatkan-pic mencatat "diteruskan", n8n mencatat hasil akhir lewat fungsi catat-wa.
create table if not exists public.wa_log (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  jenis text not null,                 -- 'pic' | 'vendor' | 'sistem'
  nama text,
  nomor text,                          -- disamarkan: hanya 4 digit terakhir
  status text not null check (status in ('diteruskan', 'terkirim', 'gagal', 'sesi_putus', 'sesi_pulih')),
  galat text,
  ref text);
create index if not exists wa_log_waktu on public.wa_log (waktu desc);
alter table public.wa_log enable row level security;

create or replace function public.wa_log_terbaru(kode text, p_batas int default 60) returns setof public.wa_log
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select * from public.wa_log order by waktu desc limit least(greatest(coalesce(p_batas, 60), 1), 300);
end $f$;
revoke all on function public.wa_log_terbaru(text, int) from public; grant execute on function public.wa_log_terbaru(text, int) to anon, authenticated;
