# Memasang fitur "Konfirmasi pesanan Mas Wahyu lewat ntfy":
#   1. migrasi database (tabel konfirmasi_vendor + fungsi daftar_konfirmasi_vendor)
#   2. deploy fungsi konfirmasi-vendor (tanpa verify_jwt, karena tombol ntfy tidak bisa mengirim JWT)
#   3. mengunggah tanda tangan Mas Wahyu (Documents\ttd-wahyu.png) ke bucket PRIVAT tanda-tangan/wahyu.png (tidak ada di repo GitHub)
#   4. mengatur rahasia NTFY_TOPIC_WAHYU (topik ntfy yang di-subscribe Mas Wahyu)
# Jalankan dari terminal Claude Code:  ! powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\pasang-konfirmasi-vendor.ps1"
# Opsional: -Topik nama-topik-sendiri  (tanpa parameter, dibuatkan nama acak). Bila rahasia sudah ada dan tidak ingin diganti: -TanpaTopik
param([string]$Topik = '', [switch]$TanpaTopik)
$ErrorActionPreference = 'Stop'
$ref  = 'vqcusagijiavaoljfrib'
$repo = "$env:USERPROFILE\Documents\ukuran-pekerja"
. "$env:USERPROFILE\keystore\keys.ps1"
$sbp  = key-get supabase -Show
$mgmt = @{ Authorization = "Bearer $sbp" }
$api  = "https://api.supabase.com/v1/projects/$ref"

# 1. migrasi
foreach ($berkas in @('migrasi-konfirmasi-vendor.sql', 'migrasi-kekurangan-surat.sql')) {
  $sql  = [IO.File]::ReadAllText("$repo\supabase\$berkas")
  $body = ConvertTo-Json -Compress -InputObject @{ query = [string]$sql }
  Invoke-RestMethod -Method Post -Uri "$api/database/query" -Headers $mgmt -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
  Write-Host "migrasi database: $berkas selesai"
}

# 2. deploy fungsi
$slug = 'konfirmasi-vendor'
$meta = Join-Path $env:TEMP "meta-$slug.json"
[IO.File]::WriteAllText($meta, (@{ entrypoint_path = 'index.ts'; name = $slug; verify_jwt = $false } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
$out = curl.exe -s -w "`nHTTP %{http_code}" -X POST "$api/functions/deploy?slug=$slug" -H "Authorization: Bearer $sbp" -F "metadata=<$meta;type=application/json" -F "file=@$repo\supabase\functions\$slug\index.ts;filename=index.ts"
Remove-Item $meta -Force
Write-Host "$slug -> $($out -replace "`n", ' ')"

# 3. tanda tangan Mas Wahyu ke bucket privat (hanya fungsi server yang membacanya)
$png = "$env:USERPROFILE\Documents\ttd-wahyu.png"
if (Test-Path $png) {
  $keys = Invoke-RestMethod -Uri "$api/api-keys?reveal=true" -Headers $mgmt
  $srv  = ($keys | Where-Object { $_.name -eq 'service_role' }).api_key
  $sb   = @{ Authorization = "Bearer $srv"; apikey = $srv; 'x-upsert' = 'true' }
  Invoke-RestMethod -Method Post -Uri "https://$ref.supabase.co/storage/v1/object/tanda-tangan/wahyu.png" -Headers $sb -ContentType 'image/png' -InFile $png | Out-Null
  Write-Host 'tanda tangan Mas Wahyu: terunggah ke bucket privat tanda-tangan/wahyu.png'
} else { Write-Host "PERINGATAN: $png tidak ditemukan; PDF memakai stempel teks tanpa gambar tanda tangan." }

# 4. rahasia topik ntfy Mas Wahyu
if (-not $TanpaTopik) {
  if (-not $Topik) { $Topik = 'ray-wahyu-' + (-join ((48..57) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })) }
  $sec = ConvertTo-Json -Compress -InputObject @(@{ name = 'NTFY_TOPIC_WAHYU'; value = $Topik })
  Invoke-RestMethod -Method Post -Uri "$api/secrets" -Headers $mgmt -ContentType 'application/json' -Body $sec | Out-Null
  $catat = "$env:USERPROFILE\Documents\ntfy-wahyu-topik.txt"
  Set-Content -Path $catat -Value $Topik -Encoding UTF8
  Write-Host ''
  Write-Host "Topik ntfy Mas Wahyu : $Topik"
  Write-Host "Tersimpan di         : $catat (bukan di repo)"
  Write-Host 'Minta Mas Wahyu memasang aplikasi ntfy dan berlangganan topik di atas (server ntfy.sh).'
}
