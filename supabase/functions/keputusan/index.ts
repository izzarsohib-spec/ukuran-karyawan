// Dipanggil dari tombol di notifikasi ntfy atasan (Setujui / Tolak/Revisi).
// verify_jwt dimatikan karena ntfy tidak bisa mengirim JWT; keamanan lewat token acak per permintaan.
import { createClient } from 'npm:@supabase/supabase-js@2';

const teks = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return teks('Gunakan tombol di notifikasi ntfy.', 405);
  const u = new URL(req.url), id = Number(u.searchParams.get('id')), t = u.searchParams.get('t') ?? '', a = u.searchParams.get('a');
  const status = a === 'setuju' ? 'disetujui' : a === 'tolak' ? 'ditolak' : null;
  if (!id || t.length < 32 || !status) return teks('Permintaan tidak valid.', 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: p } = await db.from('permintaan').select('status,client').eq('id', id).eq('token_keputusan', t).maybeSingle();
  if (!p) return teks('Tautan tidak dikenali.', 403);
  if (p.status !== 'menunggu') return teks(`Sudah diputuskan: ${p.status}.`, 409);

  const { error } = await db.from('permintaan').update({ status, diputuskan: new Date().toISOString() })
    .eq('id', id).eq('token_keputusan', t).eq('status', 'menunggu');
  if (error) return teks('Gagal menyimpan keputusan.', 500);
  return teks(`Tercatat: ${status} (${p.client}).`);
});
