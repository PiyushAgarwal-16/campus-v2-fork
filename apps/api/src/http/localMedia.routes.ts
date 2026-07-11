import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Router, raw } from 'express';
import { MEDIA_KINDS, MAX_UPLOAD_BYTES, type MediaKind } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { decodeToken, ensureDirFor, resolveStoragePath } from '../storage/localProvider.js';
import { validateUploadContent } from '../lib/uploadValidation.js';

/**
 * Local object-storage stand-in (dev only — MEDIA_DRIVER=local). Serves the
 * signed PUT/GET URLs issued by the local storage driver so the client uploads
 * bytes directly to "storage" (not through the JSON API). Mounted before the
 * JSON body parser; authorization is the signed token, not the session.
 * Production uses real object storage and these routes are inert.
 */
export const localMediaRouter: Router = Router();

if (config.MEDIA_DRIVER === 'local') {
  // Hard ceiling for the body parser = the largest currently-uploadable cap. A
  // forged/oversized PUT is rejected (413) before the body is fully buffered,
  // bounding memory/disk exposure. The exact per-kind limit + real content type
  // are re-verified below before anything is written.
  const MAX_UPLOAD = MAX_UPLOAD_BYTES;

  /** Derive the media kind from the storage key prefix (`<kind>/<uuid>`). */
  function kindFromKey(key: string): MediaKind | null {
    const prefix = key.split('/')[0];
    return (MEDIA_KINDS as readonly string[]).includes(prefix ?? '') ? (prefix as MediaKind) : null;
  }

  // PUT bytes to a signed upload URL.
  localMediaRouter.put(
    '/media/local/:token',
    raw({ type: '*/*', limit: MAX_UPLOAD }),
    (req, res) => {
      const token = decodeToken(req.params.token);
      if (!token || token.op !== 'put') {
        res.status(403).json({ error: { code: 'forbidden', message: 'Invalid upload URL.' } });
        return;
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: { code: 'validation_error', message: 'Empty upload.' } });
        return;
      }

      // Validate the ACTUAL bytes before persisting: real size against the
      // per-kind cap + magic-byte content check (blocks disguised/dangerous
      // files, disk-exhaustion, and type spoofing — the client's declared
      // size/mime are never trusted here).
      const kind = kindFromKey(token.key);
      if (!kind) {
        res
          .status(400)
          .json({ error: { code: 'validation_error', message: 'Invalid media key.' } });
        return;
      }
      const check = validateUploadContent(kind, body, token.mime);
      if (!check.ok) {
        res
          .status(check.tooLarge ? 413 : 400)
          .json({ error: { code: 'validation_error', message: check.reason ?? 'Invalid file.' } });
        return;
      }

      const abs = resolveStoragePath(token.key);
      void ensureDirFor(abs)
        .then(() => writeFile(abs, body))
        .then(() => res.status(200).json({ data: { ok: true } }))
        .catch((err) => {
          logger.error({ err }, 'local media upload failed');
          res.status(500).json({ error: { code: 'internal_error', message: 'Upload failed.' } });
        });
    },
  );

  // GET bytes from a signed download URL (streams the file).
  localMediaRouter.get('/media/local/:token', (req, res) => {
    const token = decodeToken(req.params.token);
    if (!token || token.op !== 'get') {
      res.status(403).json({ error: { code: 'forbidden', message: 'Invalid download URL.' } });
      return;
    }
    let abs: string;
    try {
      abs = resolveStoragePath(token.key);
    } catch {
      res.status(403).json({ error: { code: 'forbidden', message: 'Invalid key.' } });
      return;
    }
    res.setHeader('Content-Type', token.mime);
    // Never let the browser MIME-sniff these bytes into something executable,
    // and never render them as a top-level document (defense-in-depth for the
    // rare case a disguised file slipped through).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Allow the web app (different port/origin in dev) to load these bytes as an
    // <img>/<audio>/<video> resource. Helmet's global default is 'same-origin',
    // which would block cross-origin media display. Production serves media from
    // object storage directly, so this only applies to the local dev driver.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const stream = createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).json({ error: { code: 'not_found', message: 'Media not found.' } });
      }
    });
    stream.pipe(res);
  });
}
