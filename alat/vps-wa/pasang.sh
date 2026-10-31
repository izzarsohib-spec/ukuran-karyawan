#!/usr/bin/env bash
# Jalankan di VPS sebagai root, di folder ini:  bash pasang.sh [domain]
# Memasang Docker, membuat .env berisi kunci acak (hanya sekali), lalu menjalankan n8n + WAHA + Caddy.
set -euo pipefail
DOMAIN="${1:-srv2067124.hstgr.cloud}"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
if [ ! -f .env ]; then
  umask 077
  printf 'DOMAIN=%s\nN8N_ENCRYPTION_KEY=%s\nWAHA_API_KEY=%s\n' "$DOMAIN" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env
  echo ".env dibuat. SIMPAN isinya di tempat aman (terutama N8N_ENCRYPTION_KEY)."
else
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
fi
ufw allow OpenSSH >/dev/null 2>&1 || true; ufw allow 80,443/tcp >/dev/null 2>&1 || true; ufw --force enable >/dev/null 2>&1 || true
docker compose up -d
docker compose ps
echo "Selesai. Buka https://$DOMAIN"
