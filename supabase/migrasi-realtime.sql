-- Siaran realtime: setiap permintaan seragam dibuat atau berubah (disetujui, ditolak, ditarik, dikirim ulang, dst.),
-- database menyiarkan sinyal ringan {id, aksi} ke saluran publik "permintaan-seragam". Web yang sedang terbuka
-- mendengarkan saluran itu lalu memuat ulang datanya lewat fungsi daftar_permintaan (jadi tidak ada data sensitif di siaran).
create or replace function public.siarkan_permintaan() returns trigger
language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id, 'aksi', tg_op), 'berubah', 'permintaan-seragam', false);
  return null;
end $$;

drop trigger if exists trg_siarkan_permintaan on public.permintaan;
create trigger trg_siarkan_permintaan after insert or update on public.permintaan
  for each row execute function public.siarkan_permintaan();
