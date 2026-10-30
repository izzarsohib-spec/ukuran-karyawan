# Menerapkan supabase/migrasi-riwayat-ploting.sql (tabel ploting_riwayat, trigger, fungsi daftar_riwayat_ploting).
# Dijalankan oleh pemilik proyek; butuh kunci `supabase` di keystore lokal (tidak ada di repo).
#   powershell -ExecutionPolicy Bypass -File alat/pasang-riwayat-ploting.ps1
$ErrorActionPreference = 'Stop'
. "$env:USERPROFILE\keystore\keys.ps1"
$token = key-get supabase -Show
$ref = 'vqcusagijiavaoljfrib'
$sql = Get-Content (Join-Path $PSScriptRoot '..\supabase\migrasi-riwayat-ploting.sql') -Raw -Encoding UTF8
function Kueri($q) {
  $b = [Text.Encoding]::UTF8.GetBytes((@{ query = $q } | ConvertTo-Json))
  Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body $b
}
Kueri $sql | Out-Null
Write-Host 'Migrasi riwayat ploting diterapkan.'
$n = Kueri 'select count(*) as baris from public.ploting_riwayat'
Write-Host ("Baris riwayat sekarang: " + $n[0].baris)
