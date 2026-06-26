// Campusly V2 — PM2 process config (ARCHITECTURE.md §14.4).
//
// Runs the compiled API (Express + Socket.IO in one process) in cluster mode to
// use all ARM cores, with auto-restart and zero-downtime reloads. Secrets are
// provided by the environment / an untracked .env on the host, never here
// (SECURITY.md §10).
module.exports = {
  apps: [
    {
      name: 'campusly-api',
      cwd: './apps/api',
      script: 'dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Logs (PM2 manages rotation via pm2-logrotate in production).
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
