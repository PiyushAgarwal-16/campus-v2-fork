#!/usr/bin/env bash
# Stage 4A Steps 2-5 — Nginx HTTP reverse proxy for Campusly API. Idempotent.
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
step(){ echo "=== STEP: $* ==="; }

step "backup existing /etc/nginx"
sudo tar -czf "/etc/nginx.backup-$TS.tar.gz" -C /etc nginx
echo "backup: /etc/nginx.backup-$TS.tar.gz ($(sudo du -h /etc/nginx.backup-$TS.tar.gz | cut -f1))"

step "current enabled sites (before)"
ls -l /etc/nginx/sites-enabled/ || true

step "write server block /etc/nginx/sites-available/campusly"
sudo tee /etc/nginx/sites-available/campusly >/dev/null <<'NGINXCONF'
# Campusly API — HTTP reverse proxy (Stage 4A). Express + Socket.IO on 127.0.0.1:4000.

# Map Upgrade header -> Connection value for WebSocket proxying (http context).
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Media bytes go directly to GCS via signed URLs; keep a sane cap for JSON/proxied bodies.
    client_max_body_size 25m;

    # gzip for text assets only (safe production default; no aggressive caching).
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/javascript application/xml image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        # Preserve client + protocol info for the Node app (app sets `trust proxy`).
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # WebSocket (Socket.IO) upgrade support.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Long-lived connections for WebSocket.
        proxy_connect_timeout 60s;
        proxy_send_timeout    3600s;
        proxy_read_timeout    3600s;

        proxy_buffering on;
        proxy_redirect  off;
    }
}
NGINXCONF
echo "wrote server block"

step "enable campusly; disable stock default (file kept in sites-available)"
sudo ln -sf /etc/nginx/sites-available/campusly /etc/nginx/sites-enabled/campusly
sudo rm -f /etc/nginx/sites-enabled/default
ls -l /etc/nginx/sites-enabled/

step "nginx -t (validate; will abort before reload if this fails)"
sudo nginx -t

step "graceful reload"
sudo systemctl reload nginx
echo "nginx active: $(systemctl is-active nginx)"

echo "NGINX_SETUP_DONE_OK"
