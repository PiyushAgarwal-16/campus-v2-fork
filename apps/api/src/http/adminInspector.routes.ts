import { Router } from 'express';
import { z } from 'zod';
import { ADMIN_ROLES, MODERATOR_ROLES, InspectConversationSchema } from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { adminRateLimiter } from '../middleware/rateLimiter.js';
import { adminAccessLogger } from '../middleware/adminAccessLogger.js';
import { withDenialAudit } from '../middleware/adminAudit.js';
import { dataInspectorService } from '../services/dataInspectorService.js';

/**
 * Data_Inspector REST (ADMIN_PANEL.md, Requirement 8). Read-only inspection
 * surfaces over posts, community posts, and media metadata are Admin-gated; the
 * one privileged, scoped conversation-inspection surface is Moderator-gated.
 * Every route is RBAC-gated server-side; the UI is never the gate. Insufficient
 * role rejections are audited via {@link withDenialAudit}.
 *
 * This router is mounted (with app-level middleware) in `app.ts` under task 10.3.
 */
export const adminInspectorRouter: Router = Router();

// Admin hardening chain, ordered AFTER requireAuth so every guard reads verified
// token claims via req.auth (never client input): active-account guard →
// per-operator rate limit → hashed-address access audit → per-route tier guard
// (applied on each handler below). See Admin Control Center Req 3.1–3.6, 14.1/3/4.
adminInspectorRouter.use(requireAuth);
adminInspectorRouter.use(requireActiveAccount, adminRateLimiter, adminAccessLogger);

const admin = withDenialAudit(requireRole(...ADMIN_ROLES));
const moderator = withDenialAudit(requireRole(...MODERATOR_ROLES));

const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Read-only records (Admin) ---
adminInspectorRouter.get(
  '/admin/inspector/posts',
  admin,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    sendData(res, await dataInspectorService.listWallPosts({ cursor, limit }));
  }),
);

adminInspectorRouter.get(
  '/admin/inspector/community-posts',
  admin,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    sendData(res, await dataInspectorService.listCommunityPosts({ cursor, limit }));
  }),
);

adminInspectorRouter.get(
  '/admin/inspector/media',
  admin,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    sendData(res, await dataInspectorService.listMedia({ cursor, limit }));
  }),
);

// --- Scoped message inspection (Moderator+) ---
adminInspectorRouter.post(
  '/admin/inspector/conversation',
  moderator,
  asyncHandler(async (req, res) => {
    const input = InspectConversationSchema.parse(req.body);
    sendData(res, await dataInspectorService.inspectConversation(getAuth(req), input));
  }),
);

// --- Short-lived signed media URL (Admin) ---
adminInspectorRouter.get(
  '/admin/inspector/media/:id/url',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    sendData(res, await dataInspectorService.signMediaUrl(getAuth(req), id));
  }),
);
