-- Tanda tangan digital pimpinan di memo dan PO.
-- ttd_pos = posisi kolom tanda tangan Direktur (yasir) dan Direktur Utama (ferry) pada halaman surat, pecahan 0-1:
-- [{hal, p, x, y, w, h, cy, fs}, ...]; diisi oleh kirim-permintaan, dibaca oleh fungsi ttd-surat.
alter table public.permintaan add column if not exists ttd_pos jsonb;

-- Bucket privat untuk gambar tanda tangan (yasir.png, ferry.png); hanya dibaca fungsi ttd-surat lewat service role.
insert into storage.buckets (id, name, public) values ('tanda-tangan', 'tanda-tangan', false) on conflict (id) do nothing;
