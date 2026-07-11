import { Router } from 'express';
import { z } from 'zod';
import {
  MODERATOR_ROLES,
  ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  ApplyActionSchema,
  ResolveReportSchema,
  SetUserStatusSchema,
  CreateAnnouncementSchema,
  ToggleFlagSchema,
  ResolveAppealSchema,
  CreateAppealSchema,
  CreateUserSchema,
  EditUserSchema,
  ChangeRoleSchema,
  DeleteUserSchema,
  BulkActionSchema,
  GrantSubscriptionSchema,
  RevokeSubscriptionSchema,
  ChangeSubscriptionSchema,
} from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { adminRateLimiter } from '../middleware/rateLimiter.js';
import { adminAccessLogger } from '../middleware/adminAccessLogger.js';
import { withDenialAudit } from '../middleware/adminAudit.js';
import { adminService } from '../services/adminService.js';
import { subscriptionService } from '../services/subscriptionService.js';
import { reportContextService } from '../services/reportContextService.js';

/**
 * Admin & Moderation REST (API_SPEC.md §15, ADMIN_PANEL.md). Every route is
 * RBAC-gated server-side: moderation surfaces require Moderator+, full admin
 * surfaces require Admin+. The UI is never the gate.
 */
export const adminRouter: Router = Router();

// Admin hardening chain, ordered AFTER requireAuth so every guard reads verified
// token claims via req.auth (never client input): active-account guard →
// per-operator rate limit → hashed-address access audit → per-route tier guard
// (applied on each handler below). See Admin Control Center Req 3.1–3.6, 14.1/3/4.
adminRouter.use(requireAuth);
adminRouter.use(requireActiveAccount, adminRateLimiter, adminAccessLogger);

// Tier guards are wrapped with `withDenialAudit` so an insufficient-role
// rejection on any admin route writes an `access.permission_denied` audit
// entry before the 403 is returned (Req 3.6), without changing the 403 outcome.
const moderator = withDenialAudit(requireRole(...MODERATOR_ROLES));
const admin = withDenialAudit(requireRole(...ADMIN_ROLES));
const superAdmin = withDenialAudit(requireRole(...SUPER_ADMIN_ROLES));
const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const userIdParam = z.object({ id: z.string().uuid() });

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

// --- Universities picker (Admin) ---
adminRouter.get(
  '/admin/universities',
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, { universities: await adminService.listUniversities() });
  }),
);

// --- User lifecycle: create / edit / role change / delete (Requirements 4, 5) ---
adminRouter.post(
  '/admin/users',
  admin,
  asyncHandler(async (req, res) => {
    const input = CreateUserSchema.parse(req.body);
    const user = await adminService.createUser(getAuth(req), input);
    sendData(res, { user }, 201);
  }),
);

adminRouter.patch(
  '/admin/users/:id',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = EditUserSchema.parse(req.body);
    const user = await adminService.editUser(getAuth(req), id, input);
    sendData(res, { user });
  }),
);

adminRouter.patch(
  '/admin/users/:id/role',
  superAdmin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = ChangeRoleSchema.parse(req.body);
    const user = await adminService.changeRole(getAuth(req), id, input);
    sendData(res, { user });
  }),
);

adminRouter.delete(
  '/admin/users/:id',
  superAdmin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = DeleteUserSchema.parse(req.body);
    await adminService.softDelete(getAuth(req), id, input);
    sendData(res, { success: true });
  }),
);

// --- Per-user subscriptions (Requirement 6) ---
adminRouter.get(
  '/admin/users/:id/subscription',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const subscription = await subscriptionService.getForUser(id);
    sendData(res, { subscription });
  }),
);

adminRouter.post(
  '/admin/users/:id/subscription/grant',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = GrantSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.grant(getAuth(req), id, input);
    sendData(res, { subscription });
  }),
);

adminRouter.post(
  '/admin/users/:id/subscription/revoke',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = RevokeSubscriptionSchema.parse(req.body);
    await subscriptionService.revoke(getAuth(req), id, input);
    sendData(res, { success: true });
  }),
);

adminRouter.patch(
  '/admin/users/:id/subscription',
  admin,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = ChangeSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.change(getAuth(req), id, input);
    sendData(res, { subscription });
  }),
);

adminRouter.get(
  '/admin/subscription-plans',
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, { plans: await subscriptionService.listPlans() });
  }),
);

// --- Report context (Moderator+, Requirement 7) ---
adminRouter.get(
  '/admin/reports/:id/context',
  moderator,
  asyncHandler(async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const { reveal } = z.object({ reveal: z.string().optional() }).parse(req.query);
    const context = await reportContextService.getContext(getAuth(req), id, {
      revealIdentity: reveal === 'true',
    });
    sendData(res, context);
  }),
);

// --- Bulk actions (Admin, Requirements 11, 12) ---
adminRouter.post(
  '/admin/bulk-actions',
  admin,
  asyncHandler(async (req, res) => {
    const input = BulkActionSchema.parse(req.body);
    const results = await adminService.bulkAction(getAuth(req), input);
    sendData(res, { results });
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
