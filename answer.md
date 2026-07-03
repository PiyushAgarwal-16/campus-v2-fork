The HTTPS firewall rule has already been created successfully.

The first command completed successfully and `campusly-allow-https` now exists.

The second command failed only because it attempted to create the same firewall rule again, and Google Cloud correctly reported that the resource already exists.

Continue from this point.

Do not recreate the firewall rule.

Proceed with the remaining Stage 5 tasks:

1. Verify external HTTPS through `https://api.anonymousu.live`.
2. Verify external WebSocket (WSS) through the public domain.
3. Enable the HTTP → HTTPS permanent redirect.
4. Reload Nginx.
5. Verify:

   * HTTP returns 301 or 308.
   * HTTPS returns HTTP 200.
   * WebSockets continue working over HTTPS.
6. Perform the final Nginx and PM2 log inspection.

If all checks pass, mark Stage 5 as complete and stop.

Do not begin the frontend deployment, OAuth configuration, or any later stages.
