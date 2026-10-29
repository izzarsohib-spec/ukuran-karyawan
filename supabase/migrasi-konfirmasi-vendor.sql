-- Konfirmasi pesanan oleh vendor (Mas Wahyu) lewat notifikasi ntfy: rekap dikirim sebagai PDF, vendor menjawab dengan tombol cepat
-- (siap 3 hari / 1 minggu) atau halaman konfirmasi (pilih tanggal dd/mm/yyyy + catatan). Jawaban tersimpan sebagai estimasi datang.
-- Tabel hanya diakses fungsi server (service role) dan RPC admin di bawah; tautan vendor memakai token acak per pengiriman.

create table if not exists public.konfirmasi_vendor (
  id bigint generated always as identity primary key,
  token text not null unique,
  vendor text not null,
  permintaan_ids bigint[] not null default '{}',
  ringkasan jsonb not null default '{}'::jsonb,   -- {lokasi:[{client,bagian,pcs}], jenis:[{jenis,total}], total_pcs}
  dikirim_pada timestamptz not null default now(),
  status text not null default 'menunggu' check (status in ('menunggu', 'dikonfirmasi', 'tidak_bisa')),
  estimasi date,
  catatan text,
  dijawab_pada timestamptz,
  jumlah_jawab int not null default 0,
  pdf text                                        -- PDF rekap (base64); dibuka vendor lewat tautan, bukan lampiran ntfy (batas ukuran ntfy.sh)
);
alter table public.konfirmasi_vendor add column if not exists pdf text;
alter table public.konfirmasi_vendor add column if not exists pdf_pos jsonb;   -- letak isian estimasi dan kotak tanda tangan vendor pada PDF: {est:{hal,x,y}, ttd:{hal,x,y}}
alter table public.konfirmasi_vendor enable row level security;
revoke all on public.konfirmasi_vendor from anon, authenticated;

-- daftar untuk web (admin): tanpa token
create or replace function public.daftar_konfirmasi_vendor(kode text)
 returns table(id bigint, vendor text, permintaan_ids bigint[], ringkasan jsonb, dikirim_pada timestamptz, status text, estimasi date, catatan text, dijawab_pada timestamptz, jumlah_jawab int)
 language plpgsql stable security definer set search_path to 'public' as $f$
begin
  perform public._wajib_kode(kode);
  return query select k.id, k.vendor, k.permintaan_ids, k.ringkasan, k.dikirim_pada, k.status, k.estimasi, k.catatan, k.dijawab_pada, k.jumlah_jawab
    from public.konfirmasi_vendor k order by k.id desc limit 200;
end $f$;
revoke all on function public.daftar_konfirmasi_vendor(text) from public;
grant execute on function public.daftar_konfirmasi_vendor(text) to anon, authenticated;
