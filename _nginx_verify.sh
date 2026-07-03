#!/usr/bin/env bash
# Stage 4A Steps 6-8 — verify HTTP + WebSocket through Nginx (localhost:80) + logs.
set -uo pipefail
step(){ echo "=== STEP: $* ==="; }

step "Step6: HTTP health THROUGH nginx (port 80 -> 4000)"
echo "-- response headers /api/v1/health/live --"
curl -s -D - -o /dev/null http://localhost/api/v1/health/live | sed -n '1,10p'
printf 'live  via nginx: '; curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/api/v1/health/live
printf 'ready via nginx: '; curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/api/v1/health/ready
echo "body(live):"; curl -s http://localhost/api/v1/health/live; echo

step "Step7: Socket.IO polling handshake through nginx (open packet offers websocket upgrade)"
curl -s --max-time 8 "http://localhost/socket.io/?EIO=4&transport=polling" | head -c 200; echo

step "Step7: REAL WebSocket upgrade through nginx (Node http upgrade; expect 101)"
cat > /tmp/_ws.mjs <<'WSJS'
import http from 'node:http';
const req = http.request({ host: '127.0.0.1', port: 80, path: '/socket.io/?EIO=4&transport=websocket',
  headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
req.on('upgrade', (res, socket) => { console.log('WS_UPGRADE_OK status=' + res.statusCode + ' upgrade=' + res.headers.upgrade + ' connection=' + res.headers.connection); socket.destroy(); process.exit(0); });
req.on('response', (res) => { console.log('NO_UPGRADE status=' + res.statusCode); process.exit(1); });
req.on('error', (e) => { console.log('WS_ERROR ' + e.message); process.exit(2); });
req.setTimeout(6000, () => { console.log('WS_TIMEOUT'); process.exit(3); });
req.end();
WSJS
node /tmp/_ws.mjs; echo "ws_exit=$?"

step "Step8: nginx access log (last 6)"
sudo tail -n 6 /var/log/nginx/access.log 2>/dev/null || echo "(none)"
step "Step8: nginx error log (proxy/upgrade errors?)"
sudo tail -n 20 /var/log/nginx/error.log 2>/dev/null | grep -iE "error|upgrade|websocket|refused|502|504|crit" | tail -10 || echo "(no matching error lines)"
step "Step8: pm2 logs scan (errors/upgrade)"
pm2 logs campusly-api --lines 30 --nostream 2>/dev/null | grep -iE "error|fatal|upgrade|econnrefused" | tail -8 || echo "(no matching lines)"

rm -f /tmp/_ws.mjs
echo "NGINX_VERIFY_DONE"
