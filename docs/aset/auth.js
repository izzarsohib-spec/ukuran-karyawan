/* Login bersama (Supabase Auth) untuk portal, Seragam, dan Peralatan.
   Semua halaman boleh dibuka dan formulirnya diisi tanpa login; login hanya diminta saat menyimpan/mengirim atau membuka data karyawan.
   Sesi disimpan di localStorage (dipakai bersama oleh portal dan halaman di dalamnya). Pemeriksaan sebenarnya ada di server
   (fungsi _wajib_kode / edge function memeriksa admin_pengguna), jadi menyembunyikan tombol saja tidak cukup untuk menembusnya. */
(function () {
  const URL_ = 'https://vqcusagijiavaoljfrib.supabase.co';
  // Anon key memang publik; hak aksesnya dibatasi di Supabase.
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxY3VzYWdpamlhdmFvbGpmcmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIzOTksImV4cCI6MjEwODA2ODM5OX0.VeslVR4UHv26LCMbkO7KP0k96r8lg7-NNLjY30iMyFk';
  const PORTAL = 'https://izzarsohib-spec.github.io/ukuran-karyawan/';
  const KUNCI = 'masuk.sesi';
  const asli = window.fetch.bind(window);
  const jeda = ms => new Promise(r => setTimeout(r, ms));

  const baca = () => { try { return JSON.parse(localStorage.getItem(KUNCI)); } catch (e) { return null; } };
  function simpan(s) {
    try { s ? localStorage.setItem(KUNCI, JSON.stringify(s)) : localStorage.removeItem(KUNCI); } catch (e) {}
    window.dispatchEvent(new Event('masuk-ubah'));
  }
  window.addEventListener('storage', e => { if (e.key === KUNCI) window.dispatchEvent(new Event('masuk-ubah')); });

  const sesiDari = (j, email) => ({
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
    email: (j.user && j.user.email) || email || ''
  });
  async function auth(path, body, token, metode) {
    const r = await asli(URL_ + '/auth/v1/' + path, {
      method: metode || 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + (token || ANON), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.msg || j.error_description || j.message || 'HTTP ' + r.status); e.kode = j.error_code || j.code || ''; e.status = r.status; throw e; }
    return j;
  }
  const pesanGalat = e => e.status === 429 || /rate limit/i.test(e.message) ? 'Terlalu sering mencoba. Tunggu beberapa menit lalu coba lagi.'
    : /invalid login|invalid_credentials|Invalid/i.test(e.kode + ' ' + e.message) ? 'Email atau kata sandi salah.'
    : /weak_password|at least/i.test(e.kode + ' ' + e.message) ? 'Kata sandi terlalu lemah. Pakai minimal 10 karakter, campur huruf dan angka.'
    : /same_password/i.test(e.kode) ? 'Kata sandi baru harus berbeda dari yang lama.'
    : e.message;

  // token yang masih berlaku; diperbarui otomatis bila hampir habis
  let sedangRefresh = null;
  async function token() {
    const s = baca(); if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    if (!sedangRefresh) sedangRefresh = (async () => {
      try { const j = await auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }); simpan(sesiDari(j, s.email)); return baca().access_token; }
      catch (e) { if (e.status && e.status < 500) simpan(null); return null; }
      finally { sedangRefresh = null; }
    })();
    return sedangRefresh;
  }

  // Panggilan ke Supabase yang memakai kunci anon otomatis memakai token pengguna bila sudah login.
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const h = init && init.headers;
      if ((url.startsWith(URL_ + '/rest/') || url.startsWith(URL_ + '/functions/')) && h && !(h instanceof Headers) && !Array.isArray(h) && h.Authorization === 'Bearer ' + ANON && baca()) {
        const t = await token();
        if (t) init = Object.assign({}, init, { headers: Object.assign({}, h, { Authorization: 'Bearer ' + t }) });
      }
    } catch (e) {}
    return asli(input, init);
  };

  async function cekAdmin(t) {
    const r = await asli(URL_ + '/rest/v1/rpc/saya', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    return !!(r.ok && j && j.admin);
  }

  // ---------- tampilan ----------
  const CSS = `
  .mk-lapis{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}
  .mk-kotak{width:100%;max-width:400px;background:var(--panel,#1a1a1d);color:var(--text,#f2f2f4);border:1px solid var(--stroke,rgba(255,255,255,.14));border-radius:22px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .mk-kotak h3{margin:0 0 4px;font-size:1.15rem}
  .mk-ket{margin:0 0 14px;color:var(--muted,#9a9aa3);font-size:.86rem;line-height:1.45}
  .mk-kotak label{display:block;font-size:.8rem;color:var(--muted,#9a9aa3);margin-bottom:10px}
  .mk-kotak input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:11px 13px;border-radius:14px;border:1px solid var(--stroke,rgba(255,255,255,.14));background:rgba(255,255,255,.06);color:inherit;font:inherit;font-size:.95rem}
  .mk-kotak input:focus{outline:2px solid var(--accent,#7cc4ff);outline-offset:1px}
  .mk-pesan{min-height:1.2em;font-size:.84rem;margin:2px 0 8px;color:var(--bad,#ff7a7a)}
  .mk-pesan.ok{color:var(--ok,#6fdc9a)}
  .mk-aksi{display:flex;gap:10px;justify-content:flex-end;align-items:center}
  .mk-aksi button{border:0;border-radius:999px;padding:10px 20px;font:inherit;font-weight:600;cursor:pointer}
  .mk-ok{background:var(--accent,#7cc4ff);color:#0b0b0d}.mk-ok:disabled{opacity:.6;cursor:wait}
  .mk-batal{background:rgba(255,255,255,.08);color:inherit}
  .mk-lupa{display:inline-block;margin-top:12px;font-size:.82rem;color:var(--muted,#9a9aa3);cursor:pointer;text-decoration:underline;background:none;border:0;padding:0;font-family:inherit}
  .mk-chip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.8rem}
  .mk-chip button{border:1px solid var(--stroke,rgba(255,255,255,.2));background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer}
  .mk-chip .mk-em{color:var(--muted,#9a9aa3);overflow:hidden;text-overflow:ellipsis;max-width:100%}`;
  function pasangCss() { if (document.getElementById('mk-css')) return; const s = document.createElement('style'); s.id = 'mk-css'; s.textContent = CSS; document.head.appendChild(s); }

  let lapis = null, selesai = null;
  function tutup(hasil, galat) {
    if (lapis) { lapis.remove(); lapis = null; document.body.style.overflow = ''; }
    const s = selesai; selesai = null;
    if (s) hasil ? s.resolve(true) : s.reject(galat || new Error('Dibatalkan: login diperlukan.'));
  }
  // mode: 'masuk' | 'lupa' | 'baru' (tetapkan kata sandi dari tautan undangan/reset; tokenBaru dipakai untuk mode ini)
  function tampil(mode, opsi) {
    opsi = opsi || {}; pasangCss();
    if (lapis) lapis.remove();
    lapis = document.createElement('div'); lapis.className = 'mk-lapis';
    const judul = mode === 'baru' ? 'Tetapkan kata sandi' : mode === 'lupa' ? 'Atur ulang kata sandi' : 'Masuk';
    const ket = opsi.ket || (mode === 'baru' ? 'Buat kata sandi untuk akun Anda (minimal 10 karakter).'
      : mode === 'lupa' ? 'Masukkan email akun. Tautan untuk membuat kata sandi baru akan dikirim ke email itu.'
      : 'Halaman boleh dibuka tanpa login. Untuk menyimpan atau mengirim data, masuk dengan akun admin.');
    lapis.innerHTML = `<form class="mk-kotak" role="dialog" aria-modal="true" autocomplete="on"><h3>${judul}</h3><p class="mk-ket"></p>
      ${mode === 'baru' ? '<label>Kata sandi baru<input name="sandi" type="password" autocomplete="new-password" minlength="10" required></label><label>Ulangi kata sandi<input name="ulang" type="password" autocomplete="new-password" minlength="10" required></label>'
        : `<label>Email<input name="email" type="email" autocomplete="username" required></label>${mode === 'masuk' ? '<label>Kata sandi<input name="sandi" type="password" autocomplete="current-password" required></label>' : ''}`}
      <div class="mk-pesan" role="alert"></div>
      <div class="mk-aksi">${mode === 'baru' ? '' : '<button type="button" class="mk-batal">Batal</button>'}<button type="submit" class="mk-ok">${mode === 'baru' ? 'Simpan' : mode === 'lupa' ? 'Kirim tautan' : 'Masuk'}</button></div>
      ${mode === 'masuk' ? '<button type="button" class="mk-lupa">Lupa kata sandi?</button>' : mode === 'lupa' ? '<button type="button" class="mk-lupa">Kembali ke halaman masuk</button>' : ''}</form>`;
    lapis.querySelector('.mk-ket').textContent = ket;
    document.body.appendChild(lapis); document.body.style.overflow = 'hidden';
    const f = lapis.querySelector('form'), ps = lapis.querySelector('.mk-pesan'), ok = lapis.querySelector('.mk-ok');
    const pesan = (t, b) => { ps.textContent = t; ps.className = 'mk-pesan' + (b ? ' ok' : ''); };
    const awal = f.querySelector('input'); if (awal) setTimeout(() => awal.focus(), 30);
    const batal = lapis.querySelector('.mk-batal'); if (batal) batal.onclick = () => tutup(false);
    lapis.addEventListener('mousedown', e => { if (e.target === lapis && mode !== 'baru') tutup(false); });
    const lupa = lapis.querySelector('.mk-lupa'); if (lupa) lupa.onclick = () => tampil(mode === 'masuk' ? 'lupa' : 'masuk', opsi);
    f.onsubmit = async e => {
      e.preventDefault(); ok.disabled = true; pesan('');
      try {
        if (mode === 'masuk') {
          const email = f.email.value.trim(), j = await auth('token?grant_type=password', { email, password: f.sandi.value });
          if (!(await cekAdmin(j.access_token))) { try { await auth('logout', null, j.access_token); } catch (x) {} throw new Error('Akun ini belum terdaftar sebagai admin.'); }
          simpan(sesiDari(j, email)); tutup(true);
        } else if (mode === 'lupa') {
          await asli(URL_ + '/auth/v1/recover?redirect_to=' + encodeURIComponent(PORTAL), { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value.trim() }) });
          pesan('Jika email terdaftar, tautan sudah dikirim. Periksa kotak masuk (dan folder spam).', true);
        } else {
          if (f.sandi.value.length < 10) throw new Error('Kata sandi minimal 10 karakter.');
          if (f.sandi.value !== f.ulang.value) throw new Error('Kata sandi dan ulangannya belum sama.');
          const u = await auth('user', { password: f.sandi.value }, opsi.token.access_token, 'PUT');
          simpan(sesiDari(opsi.token, u.email)); pesan('Kata sandi tersimpan. Anda sudah masuk.', true);
          setTimeout(() => tutup(true), 1200);
        }
      } catch (err) { pesan(pesanGalat(err)); }
      ok.disabled = false;
    };
  }

  // ---------- tautan undangan / reset kata sandi (token ada di bagian # alamat) ----------
  function bacaTautan() {
    const h = location.hash.replace(/^#/, ''); if (!/access_token=|error_description=/.test(h)) return;
    const p = new URLSearchParams(h);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    const siap = () => {
      if (p.get('access_token')) {
        tampil('baru', { token: { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || 0, expires_in: Number(p.get('expires_in')) || 3600 } });
      } else {
        tampil('masuk', { ket: 'Tautan tidak berlaku atau sudah kedaluwarsa. Pilih "Lupa kata sandi?" untuk meminta tautan baru.' });
      }
    };
    if (document.body) siap(); else document.addEventListener('DOMContentLoaded', siap);
  }

  window.Masuk = {
    masuk: () => !!baca(),
    email: () => (baca() || {}).email || '',
    kode: () => baca() ? 'sesi' : '', // pengganti kode akses lama: terisi bila sudah login
    // dipakai sebelum menyimpan/mengirim: lanjut bila sudah login, kalau belum tampilkan layar masuk
    wajib() {
      if (baca()) return Promise.resolve(true);
      if (selesai) return new Promise((resolve, reject) => { const s = selesai; selesai = { resolve: v => { s.resolve(v); resolve(v); }, reject: e => { s.reject(e); reject(e); } }; });
      return new Promise((resolve, reject) => { selesai = { resolve, reject }; tampil('masuk'); });
    },
    async keluar() { const s = baca(); simpan(null); if (s) { try { await auth('logout', null, s.access_token); } catch (e) {} } },
    // isi elemen dengan status akun + tombol Masuk/Keluar
    widget(el) {
      pasangCss();
      const gambar = () => {
        const s = baca();
        el.innerHTML = s ? `<div class="mk-chip"><span class="mk-em"></span><button type="button" data-a="keluar">Keluar</button></div>` : `<div class="mk-chip"><button type="button" data-a="masuk">Masuk</button></div>`;
        if (s) el.querySelector('.mk-em').textContent = s.email;
      };
      el.onclick = e => { const a = e.target.dataset && e.target.dataset.a; if (a === 'masuk') window.Masuk.wajib().catch(() => {}); else if (a === 'keluar') window.Masuk.keluar(); };
      window.addEventListener('masuk-ubah', gambar); gambar();
    },
    token
  };
  bacaTautan();
  // di dalam portal (iframe) tautan "Halaman Utama" disembunyikan: portal sudah punya sidebar sendiri
  if (window.top !== window.self) { pasangCss(); const st = document.createElement('style'); st.textContent = 'a.home,a.mobhome,.mobnav>a[href="../"]{display:none!important}'; document.head.appendChild(st); }
})();
