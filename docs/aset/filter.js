/* Filter cabang / PIC lapangan yang dipakai bersama oleh portal, Seragam, Peralatan, dan Administrator.
   Pilihan disimpan di localStorage (satu pilihan untuk semua halaman, termasuk yang dibuka di dalam portal) dan diumumkan lewat
   peristiwa 'saring-ubah' di window. Tiap halaman menyaring datanya sendiri dengan Saring.boleh(namaLokasi) lalu menggambar ulang.
   Peta penugasan berasal dari fungsi publik daftar_penugasan_publik (hanya nama cabang, nama PIC, dan pasangan lokasinya). */
(function () {
  const URL_ = 'https://vqcusagijiavaoljfrib.supabase.co';
  // Anon key memang publik; hak aksesnya dibatasi di Supabase.
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxY3VzYWdpamlhdmFvbGpmcmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIzOTksImV4cCI6MjEwODA2ODM5OX0.VeslVR4UHv26LCMbkO7KP0k96r8lg7-NNLjY30iMyFk';
  const KUNCI = 'filter.lokasi', TANPA = '__tanpa';
  let peta = new Map(), cab = [], pic = [], dimuat = false;

  const baca = () => { try { return Object.assign({ cabang: '', pic: '' }, JSON.parse(localStorage.getItem(KUNCI)) || {}); } catch (e) { return { cabang: '', pic: '' }; } };
  const tulis = f => { try { localStorage.setItem(KUNCI, JSON.stringify(f)); } catch (e) {} };
  const umumkan = () => window.dispatchEvent(new Event('saring-ubah'));
  window.addEventListener('storage', e => { if (e.key === KUNCI) umumkan(); });

  const siap = (async () => {
    try {
      const r = await fetch(URL_ + '/rest/v1/rpc/daftar_penugasan_publik', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status);
      cab = j.cabang || []; pic = j.pic || []; peta = new Map((j.lokasi || []).map(x => [x.l, x])); dimuat = true;
    } catch (e) { dimuat = false; }
  })();

  const aktif = () => { const f = baca(); return dimuat && !!(f.cabang || f.pic); };
  function boleh(nama) {
    if (!aktif()) return true;
    const f = baca(), x = peta.get(String(nama == null ? '' : nama).toUpperCase());
    if (f.pic === TANPA) return (!x || !x.p) && (!f.cabang || (!!x && String(x.c) === String(f.cabang)));
    if (f.pic) return !!x && String(x.p) === String(f.pic);
    return !!x && String(x.c) === String(f.cabang);
  }
  function set(o) {
    const f = Object.assign(baca(), o);
    if (f.pic && f.pic !== TANPA && f.cabang && !pic.some(p => String(p.id) === String(f.pic) && String(p.cabang_id) === String(f.cabang))) f.pic = '';
    tulis(f); umumkan();
  }
  const jumlah = () => [...peta.keys()].filter(boleh).length;
  function label() {
    const f = baca(); if (!aktif()) return 'Semua lokasi';
    const c = cab.find(x => String(x.id) === String(f.cabang)), p = pic.find(x => String(x.id) === String(f.pic));
    return f.pic === TANPA ? 'Belum ada PIC' + (c ? ' · ' + c.nama : '') : p ? 'PIC ' + p.nama : c ? 'Cabang ' + c.nama : 'Semua lokasi';
  }

  const CSS = `
  .sf{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;font-size:.78rem;color:var(--muted,#a4a4ae)}
  .sf.sisi{flex-direction:column;align-items:stretch;gap:8px}
  .sf label{display:block;min-width:0} .sf.sisi label{width:100%}
  .sf select{display:block;width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid var(--stroke,rgba(255,255,255,.14));border-radius:12px;padding:7px 10px;color:var(--text,#f5f5f7);font:inherit;font-size:.82rem;min-width:150px}
  .sf select option{background:#202024}
  .sf .sk{align-self:center;white-space:nowrap} .sf .sk b{color:var(--text,#f5f5f7)}
  .sf button{border:1px solid var(--stroke,rgba(255,255,255,.2));background:rgba(255,255,255,.06);color:inherit;border-radius:99px;padding:5px 12px;font:inherit;font-size:.76rem;cursor:pointer}
  .sf.aktif select{border-color:var(--accent,#f5d547)}
  .sfwrap{margin:0 0 14px;padding:10px 14px;border:1px solid var(--stroke,rgba(255,255,255,.12));border-radius:18px;background:rgba(255,255,255,.05)}`;
  function pasangCss() { if (document.getElementById('sf-css')) return; const s = document.createElement('style'); s.id = 'sf-css'; s.textContent = CSS; document.head.appendChild(s); }

  // gambar pilihan cabang dan PIC di elemen el. mode 'sisi' = menumpuk (sidebar portal), 'baris' = mendatar (di atas halaman)
  function bar(el, mode) {
    pasangCss();
    const gambar = () => {
      const f = baca();
      el.innerHTML = `<div class="sf ${mode || 'baris'} ${aktif() ? 'aktif' : ''}">
        <label>Cabang<select data-f="cabang"><option value="">Semua cabang</option>${cab.map(c => `<option value="${c.id}" ${String(c.id) === String(f.cabang) ? 'selected' : ''}>${esc(c.nama)}</option>`).join('')}</select></label>
        <label>PIC lapangan<select data-f="pic"><option value="">Semua PIC</option>${pic.filter(p => !f.cabang || String(p.cabang_id) === String(f.cabang)).map(p => `<option value="${p.id}" ${String(p.id) === String(f.pic) ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}<option value="${TANPA}" ${f.pic === TANPA ? 'selected' : ''}>Belum ada PIC</option></select></label>
        <div class="sk">${dimuat ? `<b>${jumlah()}</b> lokasi${aktif() ? ' · ' + esc(label()) : ''}` : 'memuat…'}</div>${aktif() ? '<button type="button" data-f="reset">Hapus filter</button>' : ''}</div>`;
    };
    el.onchange = e => { const k = e.target.dataset && e.target.dataset.f; if (k === 'cabang') set({ cabang: e.target.value, pic: '' }); else if (k === 'pic') set({ pic: e.target.value }); };
    el.onclick = e => { if (e.target.dataset && e.target.dataset.f === 'reset') set({ cabang: '', pic: '' }); };
    window.addEventListener('saring-ubah', gambar); gambar(); siap.then(gambar);
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // PIC yang memegang suatu lokasi ({id, nama}) atau null bila belum ada
  const picDari = nama => { const x = peta.get(String(nama == null ? '' : nama).toUpperCase()); return x && x.p ? pic.find(p => String(p.id) === String(x.p)) || null : null; };

  window.Saring = { siap, boleh, aktif, set, get: baca, label, jumlah, bar, picDari, TANPA };

  // dibuka sendiri (bukan di dalam portal): pasang bar di bagian atas elemen yang ditunjuk atribut data-otomatis pada tag script
  const sc = document.currentScript;
  if (sc && sc.dataset.otomatis && window.top === window.self) {
    const induk = document.querySelector(sc.dataset.otomatis);
    if (induk) { const w = document.createElement('div'); w.className = 'sfwrap'; induk.prepend(w); bar(w, 'baris'); }
  }
})();
