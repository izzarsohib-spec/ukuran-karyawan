-- Rumus angka permintaan (sama di form web, PDF Daftar Harga, notifikasi pimpinan, dan dashboard):
--   sisa RAB = anggaran - total JUAL (termasuk permintaan sebelumnya pada bagian yang sama, yang ditolak tidak dihitung)
--   untung   = sisa RAB + (total jual - total beli)
-- Hitung ulang kolom `untung` permintaan yang sudah ada (sekali jalan).
with h as (
  select id, rab, total_jual, total_beli,
         coalesce(sum(total_jual) filter (where status is distinct from 'ditolak') over (partition by lokasi_form, bagian_kerja order by dibuat, id rows between unbounded preceding and 1 preceding), 0) as lalu
  from public.permintaan)
update public.permintaan p set untung = (h.rab - h.lalu - h.total_jual) + (h.total_jual - h.total_beli) from h where h.id = p.id;
