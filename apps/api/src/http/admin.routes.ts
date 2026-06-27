import { Router } from 'express';
import { z } from 'zod';
import {
  MODERATOR_ROLES,
  ADMIN_ROLES,
  ApplyActionSchema,
  ResolveReportSchema,
  SetUserStatusSchema,
  CreateAnnouncementSchema,
  ToggleFlagSchema,
  ResolveAppealSchema,
  CreateAppealSchema,
} from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { adminService } from '../services/adminService.js';

/**
 * Admin & Moderation REST (API_SPEC.md §15, ADMIN_PANEL.md). Every route is
 * RBAC-gated server-side: moderation surfaces require Moderator+, full admin
 * surfaces require Admin+. The UI is never the gate.
 */
export const adminRouter: Router = Router();

adminRouter.use(requireAuth);

const moderator = requireRole(...MODERATOR_ROLES);
const admin = requireRole(...ADMIN_ROLES);
const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Dashboard (Admin) ---
adminRouter.get(
  '/admin/dashboard',
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, await adminService.dashboard());
  }),
);

// --- Reports & moderation (Moderator+) ---
adminRouter.get(
  '/admin/reports',
  moderator,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    const statuses = status ? status.split(',') : undefined;
    sendData(res, await adminService.reportQueue(statuses, cursor, limit));
  }),
);

adminRouter.patch(
  '/admin/reports/:id',
  moderator,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = ResolveReportSchema.parse(req.body);
    await adminService.resolveReport(getAuth(req), id, status);
    sendData(res, { success: true });
  }),
);

adminRouter.post(
  '/admin/moderation/actions',
  moderator,
  asyncHandler(async (req, res) => {
    const input = ApplyActionSchema.parse(req.body);
    await adminService.applyAction(getAuth(req), input);
    sendData(res, { success: true }, 201);
  }),
);

adminRouter.get(
  '/admin/moderation/appeals',
  moderator,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    const appeals = await adminService.listAppeals(status ? status.split(',') : undefined);
    sendData(res, { appeals });
  }),
);

adminRouter.post(
  '/admin/moderation/appeals/:id',
  moderator,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = ResolveAppealSchema.parse(req.body);
    await adminService.resolveAppeal(getAuth(req), id, status);
    sendData(res, { success: true });
  }),
);

// --- User management (Admin) ---
adminRouter.get(
  '/admin/users',
  admin,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    sendData(res, await adminService.listUsers(q, cursor, limit));
  }),
);

adminRouter.get(
  '/admin/users/:id',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    sendData(res, await adminService.userHistory(id));
  }),
);

adminRouter.patch(
  '/admin/users/:id/status',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = SetUserStatusSchema.parse(req.body);
    await adminService.setUserStatus(getAuth(req), id, input);
    sendData(res, { success: true });
  }),
);

// --- Feature flags (Admin) ---
adminRouter.get(
  '/admin/feature-flags',
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, { flags: await adminService.listFlags() });
  }),
);

adminRouter.patch(
  '/admin/feature-flags/:key',
  admin,
  asyncHandler(async (req, res) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(req.params);
    const { isEnabled } = ToggleFlagSchema.parse(req.body);
    const flag = await adminService.setFlag(getAuth(req), key, isEnabled);
    sendData(res, { flag });
  }),
);

// --- Announcements (Admin) ---
adminRouter.post(
  '/admin/announcements',
  admin,
  asyncHandler(async (req, res) => {
    const input = CreateAnnouncementSchema.parse(req.body);
    const announcement = await adminService.createAnnouncement(getAuth(req), input);
    sendData(res, { announcement }, 201);
  }),
);

adminRouter.get(
  '/admin/announcements',
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, { announcements: await adminService.listAnnouncements() });
  }),
);

// --- Audit logs (Admin) ---
adminRouter.get(
  '/admin/audit-logs',
  admin,
  asyncHandler(async (req, res) => {
    const { cursor, limit } = cursorQuery.parse(req.query);
    sendData(res, await adminService.auditLogs(cursor, limit));
  }),
);

/**
 * User-facing appeal submission (not under /admin). Any authenticated user may
 * appeal an action taken against them (ADMIN_PANEL.md §5).
 */
export const appealRouter: Router = Router();
appealRouter.use(requireAuth);
appealRouter.post(
  '/moderation/appeals',
  asyncHandler(async (req, res) => {
    const { actionId, message } = CreateAppealSchema.parse(req.body);
    const appeal = await adminService.fileAppeal(getAuth(req), actionId, message);
    sendData(res, { appeal }, 201);
  }),
);
