# Infrastructure

Deployment configuration for Campusly V2 (no secrets — see `SECURITY.md` §10).
Full production provisioning is detailed in Phase 15 (`implementation/15_DEPLOYMENT.md`).

## Layout

- `nginx/campusly.conf` — Reverse proxy + TLS termination skeleton. Routes HTTPS
  REST (`/api/`) and WSS (`/socket.io/`) to the Node process on `127.0.0.1:4000`.
  Fill in the real domain and Let's Encrypt certificate paths at provisioning.
- `pm2/ecosystem.config.cjs` — PM2 process config. Runs the compiled API
  (`apps/api/dist/index.js`) in cluster mode with auto-restart.

## Target host

Single Oracle Cloud ARM Always Free VM (Ubuntu LTS) running the API + Socket.IO,
PostgreSQL, and Nginx (`ARCHITECTURE.md` §14, `TECH_STACK.md` §1.7). The single
point of failure is an accepted, documented trade-off for the validation phase
(`REVIEW_REPORT.md` H-4), mitigated by backups and fast restart.

## Deploy outline (Phase 15 expands this)

1. Build: `npm ci && npm run build`
2. Run DB migrations: `npm run db:migrate --workspace @campusly/api`
3. Start/reload: `pm2 startOrReload infra/pm2/ecosystem.config.cjs`
4. Nginx: symlink `nginx/campusly.conf` into `sites-enabled`, `nginx -t`, reload.
