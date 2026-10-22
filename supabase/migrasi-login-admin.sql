-- Login per orang (Supabase Auth) menggantikan kode akses bersama. Bagian ini hanya MENAMBAH (aman dijalankan kapan saja);
-- peralihan fungsi tulis dari kode akses ke login ada di migrasi-login-admin-alih.sql.

-- siapa yang boleh mengubah data. Peran 'admin' = PIC Pengadaan (admin penuh). Peran lain bisa ditambah nanti.
create table if not exists public.admin_pengguna (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  peran text not null default 'admin' check (peran in ('admin')),
  aktif boolean not null default true,
  dibuat timestamptz not null default now()
);
alter table public.admin_pengguna enable row level security;
revoke all on table public.admin_pengguna from anon, authenticated;

-- true bila pemanggil sedang login (JWT) dan terdaftar sebagai admin aktif. auth.uid() null untuk pemanggil anonim.
create or replace function public._adalah_admin() returns boolean
 language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from public.admin_pengguna a where a.user_id = auth.uid() and a.aktif) $f$;
revoke all on function public._adalah_admin() from public, anon, authenticated;

-- untuk tampilan: status login pemanggil (tanpa membuka tabel). Boleh dipanggil siapa saja.
create or replace function public.saya() returns jsonb
 language sql stable security definer set search_path to 'public' as $f$
  select jsonb_build_object('login', auth.uid() is not null, 'admin', public._adalah_admin(),
                            'email', (select a.email from public.admin_pengguna a where a.user_id = auth.uid())) $f$;
revoke all on function public.saya() from public; grant execute on function public.saya() to anon, authenticated;
