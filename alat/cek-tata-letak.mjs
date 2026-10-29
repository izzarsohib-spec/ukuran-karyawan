#!/usr/bin/env node
// Pemeriksa tata letak otomatis untuk web administrasi pengadaan.
// Membuka setiap halaman modul Seragam di Chrome (tanpa instalasi apa pun, butuh Node 22+ dan Chrome), lalu melaporkan:
//   KRITIS      kontrol keluar dari kartunya, elemen terpotong (overflow tersembunyi), error JavaScript
//   PERINGATAN  tabel yang harus digeser ke samping, teks dropdown terpotong, halaman bergulir melebihi layar
//   INFO        kartu .k3 dengan ruang kosong besar atau gaya (sudut) tidak sama dengan acuan, huruf terlalu kecil
// Acuan gaya: halaman Monitoring pengisian (kartu putih polos: sudut 16px, padding 20px 22px, garis #DCE3EC, bayangan halus). Halaman Permintaan memakai gaya lamanya sendiri dan tidak diperiksa gayanya.
//
// Pakai:  node alat/cek-tata-letak.mjs                       (situs langsung, semua halaman, layar 1500x1000)
//         node alat/cek-tata-letak.mjs --url http://localhost:8000/seragam/ --halaman datang,kurang --lebar 1366 --tinggi 768
//         node alat/cek-tata-letak.mjs --keluar alat/hasil     (simpan tangkapan layar tiap halaman)
// Kode keluar 1 bila ada temuan KRITIS (bisa dipakai sebelum push).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s--/).filter(Boolean).map(a => { const [k, ...v] = a.replace(/^--/, '').trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const URL_DASAR = String(arg.url || 'https://izzarsohib-spec.github.io/ukuran-karyawan/seragam/');
const LEBAR = Number(arg.lebar || 1500), TINGGI = Number(arg.tinggi || 1000), TUNGGU = Number(arg.tunggu || 7500), KELUAR = arg.keluar && arg.keluar !== true ? String(arg.keluar) : '';
const CHROME = process.env.CHROME || arg.chrome || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => existsSync(p));
// halaman yang diperiksa: kunci = hash, klik = teks chip/tombol yang diklik sesudah dimuat
const SEMUA = [
  { h: 'ringkasan', n: 'Dashboard Utama' }, { h: 'monitor', n: 'Monitoring pengisian (acuan)' }, { h: 'permintaan', n: 'Permintaan seragam' },
  { h: 'rekap', n: 'Pemesanan: Belum selesai ditandai' }, { h: 'rekap', klik: 'Riwayat & monitoring', n: 'Pemesanan: Riwayat & monitoring' },
  { h: 'datang', n: 'Pemesanan: Barang datang' }, { h: 'kurang', n: 'Pemesanan: Kekurangan vendor' },
  { h: 'inventaris', n: 'Inventaris' }, { h: 'opname', n: 'Stock opname' }, { h: 'retur', n: 'Retur' },
  { h: 'ploting', n: 'Ploting' }, { h: 'pengiriman', n: 'Pengiriman' }, { h: 'penerimaan', n: 'Penerimaan' }, { h: 'tagihan', n: 'Tagihan' },
];
const DAFTAR = arg.halaman && arg.halaman !== true ? SEMUA.filter(x => String(arg.halaman).split(',').includes(x.h)) : SEMUA;
const tunggu = ms => new Promise(r => setTimeout(r, ms));
if (!CHROME) { console.error('Chrome tidak ditemukan. Atur variabel CHROME atau --chrome <jalur>.'); process.exit(2); }

// ---- pemeriksaan di dalam halaman ----
const PERIKSA = `(() => {
  const root = [...document.querySelectorAll('.page')].find(p => !p.hidden) || document.body;
  const nyata = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  const nama = el => { const t = (el.innerText || el.value || el.placeholder || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 40); return (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) + (t ? ' "' + t + '"' : ''); };
  const temuan = [], tambah = (jenis, tingkat, el, pesan) => temuan.push({ jenis, tingkat, el: nama(el), pesan });
  const kanvas = document.createElement('canvas').getContext('2d');
  // 1. kontrol keluar dari kartunya
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href]')) {
    if (!nyata(el)) continue; const kartu = el.closest('.k3, .card, .pcard, .detail'); if (!kartu || kartu === el) continue;
    let anc = el.parentElement, tergulir = false; while (anc && anc !== kartu) { const o = getComputedStyle(anc).overflowX; if (o !== 'visible') { tergulir = true; break; } anc = anc.parentElement; } if (tergulir) continue;
    const r = el.getBoundingClientRect(), k = kartu.getBoundingClientRect();
    if (r.right > k.right + 1 || r.left < k.left - 1) tambah('keluar-kartu', 'KRITIS', el, 'melewati tepi kartu sejauh ' + Math.round(Math.max(r.right - k.right, k.left - r.left)) + 'px');
  }
  // 2. elemen terpotong atau perlu digeser ke samping
  for (const el of root.querySelectorAll('*')) {
    if (!nyata(el)) continue; const cs = getComputedStyle(el), lebih = el.scrollWidth - el.clientWidth;
    if (lebih <= 2 || el.clientWidth < 40) continue;
    if (['auto', 'scroll'].includes(cs.overflowX) && !el.matches('select, input, textarea, textarea *')) tambah('geser-ke-samping', 'PERINGATAN', el, 'isi lebih lebar ' + lebih + 'px dari kotaknya, pengguna harus menggeser');
    else if (['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.matches('div, section, td, th, label, span, p, li')) tambah('terpotong', 'KRITIS', el, 'isi terpotong ' + lebih + 'px (overflow tersembunyi)');
  }
  // 3. teks dropdown terpotong
  for (const sel of root.querySelectorAll('select')) {
    if (!nyata(sel) || !sel.options[sel.selectedIndex]) continue; const cs = getComputedStyle(sel); kanvas.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const teks = sel.options[sel.selectedIndex].textContent.trim(), lebarTeks = kanvas.measureText(teks).width, ruang = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 26;
    if (lebarTeks > ruang + 1) tambah('dropdown-terpotong', 'PERINGATAN', sel, '"' + teks.slice(0, 30) + '" butuh ' + Math.round(lebarTeks) + 'px, tersedia ' + Math.round(ruang) + 'px');
  }
  // 4. kartu .k3: gaya dan ruang kosong
  for (const k of root.querySelectorAll('.k3')) {
    if (!nyata(k)) continue; const cs = getComputedStyle(k), r = k.getBoundingClientRect();
    if (root.id !== 'pg-permintaan' && (cs.borderRadius !== '16px' || cs.backgroundColor !== 'rgb(255, 255, 255)')) tambah('gaya-kartu', 'INFO', k, 'sudut ' + cs.borderRadius + ', latar ' + cs.backgroundColor + ' (acuan 16px, putih)');
    if (r.height > 320) { let bawah = r.top; for (const c of k.children) { if (!nyata(c)) continue; bawah = Math.max(bawah, c.getBoundingClientRect().bottom); } const kosong = (r.bottom - bawah) / r.height; if (kosong > 0.4) tambah('ruang-kosong', 'INFO', k, Math.round(kosong * 100) + '% bagian bawah kartu kosong'); }
  }
  // 5. huruf terlalu kecil
  let kecil = 0; for (const el of root.querySelectorAll('span, label, small, td, th, li, p, b, a, button')) { if (kecil >= 5) break; if (!nyata(el) || !el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; const px = parseFloat(getComputedStyle(el).fontSize); if (px < 10.5) { tambah('huruf-kecil', 'INFO', el, px.toFixed(1) + 'px'); kecil++; } }
  const bergulir = document.documentElement.scrollHeight - window.innerHeight;
  if (bergulir > 4) tambah('halaman-bergulir', 'INFO', root, 'halaman lebih panjang ' + bergulir + 'px dari layar');
  return { id: root.id || 'body', temuan, scrollH: document.documentElement.scrollHeight };
})()`;

// ---- Chrome DevTools ----
const profil = mkdtempSync(join(tmpdir(), 'cek-tata-letak-')), PORT = 9340 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT, '--window-size=' + LEBAR + ',' + TINGGI, '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore' });
let daftar; for (let i = 0; i < 60; i++) { try { daftar = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); if (daftar.length) break; } catch { } await tunggu(250); }
if (!daftar) { console.error('Tidak bisa terhubung ke Chrome.'); chrome.kill(); process.exit(2); }
const ws = new WebSocket(daftar.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let n = 0, galat = []; const tunda = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && tunda.has(m.id)) { tunda.get(m.id)(m); tunda.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') galat.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 160)); };
const kirim = (method, params = {}) => new Promise(r => { const id = ++n; tunda.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async js => { const r = await kirim('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? { galatEval: r.result?.exceptionDetails?.exception?.description || r.result?.exceptionDetails?.text }; };
await kirim('Page.enable'); await kirim('Runtime.enable'); await kirim('Emulation.setDeviceMetricsOverride', { width: LEBAR, height: TINGGI, deviceScaleFactor: 1, mobile: false });
if (KELUAR) mkdirSync(KELUAR, { recursive: true });

const urutan = { KRITIS: 0, PERINGATAN: 1, INFO: 2 }, ringkas = { KRITIS: 0, PERINGATAN: 0, INFO: 0 }, hasil = [];
for (const hal of DAFTAR) {
  galat = []; await kirim('Page.navigate', { url: URL_DASAR + '?cek=' + Date.now() + '#' + hal.h }); await tunggu(TUNGGU);
  if (hal.klik) { await ev(`(() => { const b = [...document.querySelectorAll('.page:not([hidden]) .chip, .page:not([hidden]) button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(hal.klik)})); if (b) b.click(); return !!b; })()`); await tunggu(1500); }
  const r = await ev(PERIKSA);
  if (r.galatEval) { console.log('\n' + hal.n + ': pemeriksaan gagal: ' + r.galatEval); continue; }
  const t = r.temuan; for (const e of galat) t.push({ jenis: 'error-js', tingkat: 'KRITIS', el: 'konsol', pesan: e });
  // gabungkan temuan kembar (jenis + elemen sama) dan batasi tiap jenis
  const peta = new Map(); for (const x of t) { const k = x.jenis + '|' + x.el + '|' + x.pesan; if (!peta.has(k)) peta.set(k, x); }
  const pergrup = {}, tersaring = []; for (const x of [...peta.values()].sort((a, b) => urutan[a.tingkat] - urutan[b.tingkat])) { pergrup[x.jenis] = (pergrup[x.jenis] || 0) + 1; if (pergrup[x.jenis] <= 6) tersaring.push(x); }
  for (const x of peta.values()) ringkas[x.tingkat]++;
  hasil.push({ halaman: hal.n, hash: hal.h, temuan: tersaring, jumlahPerJenis: pergrup });
  console.log('\n== ' + hal.n + '  (#' + hal.h + ', tinggi halaman ' + r.scrollH + 'px)');
  if (!tersaring.length) console.log('   bersih');
  for (const x of tersaring) console.log('   [' + x.tingkat + '] ' + x.jenis + ': ' + x.el + ' - ' + x.pesan);
  for (const [j, c] of Object.entries(pergrup)) if (c > 6) console.log('   ... ' + (c - 6) + ' temuan ' + j + ' lainnya');
  if (KELUAR) { const s = await kirim('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(KELUAR, (hal.h + (hal.klik ? '-' + hal.klik.replace(/\W+/g, '') : '')) + '.png'), Buffer.from(s.result.data, 'base64')); }
}
console.log('\nRINGKASAN  kritis: ' + ringkas.KRITIS + '  peringatan: ' + ringkas.PERINGATAN + '  info: ' + ringkas.INFO + '  (layar ' + LEBAR + 'x' + TINGGI + ', ' + URL_DASAR + ')');
if (arg.json) writeFileSync(String(arg.json), JSON.stringify({ waktu: new Date().toISOString(), url: URL_DASAR, layar: [LEBAR, TINGGI], ringkas, hasil }, null, 1));
ws.close(); chrome.kill();
process.exit(ringkas.KRITIS ? 1 : 0);
