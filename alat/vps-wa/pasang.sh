#!/usr/bin/env bash
# Jalankan di VPS sebagai root, di /opt/wa:  bash pasang.sh [domain]
# Membuat .env berisi kunci acak (sekali), menjalankan n8n + WAHA, lalu menambah satu blok alamat ke Caddy ntfy (/opt/ntfy).
set -euo pipefail
DOMAIN="${1:-n8n.72-61-143-71.sslip.io}"
CADDY_DIR=/opt/ntfy
if [ ! -f .env ]; then
  umask 077
  printf 'DOMAIN=%s\nN8N_ENCRYPTION_KEY=%s\nWAHA_API_KEY=%s\n' "$DOMAIN" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env
  echo ".env dibuat. SIMPAN isinya di tempat aman (terutama N8N_ENCRYPTION_KEY)."
fi
docker compose up -d
if ! grep -q "^$DOMAIN" "$CADDY_DIR/Caddyfile"; then
  cp "$CADDY_DIR/Caddyfile" "$CADDY_DIR/Caddyfile.bak-n8n"
  printf '\n%s {\n\treverse_proxy n8n:5678\n}\n' "$DOMAIN" >> "$CADDY_DIR/Caddyfile"
  docker exec ntfy-caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec ntfy-caddy caddy reload --config /etc/caddy/Caddyfile
fi
docker compose ps
echo "Selesai. Buka https://$DOMAIN"
