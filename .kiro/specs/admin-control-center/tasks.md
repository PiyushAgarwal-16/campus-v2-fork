# Implementation Plan: Admin Control Center

## Overview

This plan implements the Admin Control Center as an **extension** of the existing admin surface, built bottom-up: shared-types contracts first, then the subscription data layer (schema + migration + seed), repositories, services, the tiered Authorization_Guard and hardening middleware, HTTP routes, and finally the guarded web Admin Console. Every task preserves existing admin/moderation contracts (`@campusly/shared-types`, `adminService`, `adminRepository`, `admin.routes.ts`, `apps/web/lib/admin.ts`) — new fields are additive and optional, and existing files are extended, never rewritten.

Implementation language is **TypeScript (strict)**, matching the existing monorepo. Property-based tests use `fast-check` on Vitest in `apps/api`, ≥100 iterations per Correctness Property, tagged `// Feature: admin-control-center, Property N`. Web tests cover the guarded layout and accessibility. Follow project standards: TS strict, no non-null assertions, relative imports in `apps/web`, `cn()` helper, semantic Tailwind tokens, `lucide-react`, and CVA for variant primitives.

## Tasks

- [x] 1. Shared-types contracts (DTOs + Zod schemas)
  - [x] 1.1 Create subscription contracts module
    - Create `packages/shared-types/src/subscription.ts` with `SUBSCRIPTION_PLAN_INTERVALS`, `USER_SUBSCRIPTION_STATUSES`, `SUBSCRIPTION_SOURCES` const tuples; `SubscriptionPlan` and `UserSubscriptionState` interfaces; and `GrantSubscriptionSchema`, `ChangeSubscriptionSchema` (with `.refine` for planId-or-currentPeriodEnd), `RevokeSubscriptionSchema`
    - Reuse existing `SubscriptionStatus` cache type for `cachedStatus`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6; Design "Shared-types contracts to add"_
  - [x] 1.2 Extend admin contracts module
    - Extend `packages/shared-types/src/admin.ts` with `SUPER_ADMIN_ROLES` and new schemas/DTOs: `CreateUserSchema`, `EditUserSchema` (verified fields intentionally absent), `ChangeRoleSchema`, `DeleteUserSchema`, `BulkActionSchema`, `BulkActionResult`, `ReportContext`, `TranscriptMessage`, `InspectConversationSchema`, plus inspector DTOs (`InspectedPost`, `InspectedMediaMeta`, `ConversationTranscript`)
    - Keep all existing exports unchanged (additive only); re-export new modules from `packages/shared-types/src/index.ts`
    - _Requirements: 3 (roles), 4, 5.3, 5.4, 5.5, 5.7, 7, 8, 11, 12_
  - [ ]* 1.3 Write unit tests for schema parsing and refinements
    - Verify `ChangeSubscriptionSchema` requires planId or currentPeriodEnd, `BulkActionSchema` enforces `min(1).max(100)`, `EditUserSchema` omits verified fields, `InspectConversationSchema` requires reportId or investigationContext
    - _Requirements: 5.4, 9.5, 11.2_

- [x] 2. Subscription data layer (Drizzle schema + migration + seed)
  - [x] 2.1 Add subscription enums and tables to schema
    - In `apps/api/src/db/schema.ts` add `subscriptionIntervalEnum`, `userSubscriptionStatusEnum`, `subscriptionSourceEnum`, `subscriptionTxnTypeEnum`, `subscriptionTxnStatusEnum`, and tables `subscriptionPlans`, `userSubscriptions`, `subscriptionTransactions` with indexes (partial active index on `user_subscriptions`, `current_period_end` index, unique `code`, unique `(provider, provider_ref)`) and `$inferSelect` row types
    - Retain the existing `subscriptionStatusEnum` (`free`/`premium`) on `users` as the denormalized cache; make no structural change to `users`
    - _Requirements: 6 (DATABASE_SCHEMA.md §17); Design "New subscription tables"_
  - [x] 2.2 Generate the Drizzle migration
    - Run `drizzle-kit generate` to produce `apps/api/src/db/migrations/0011_*.sql` and its `meta` snapshot from the schema change
    - _Requirements: 6_
  - [x] 2.3 Author subscription plan seed
    - Add a seed in `apps/api/src/db/seeds/` (wired through `apps/api/src/db/seed.ts`) inserting a `free` plan (`code='free'`, `price_cents=0`, `interval='none'`) and a `premium_monthly` plan so admin grants have a target; idempotent upsert on `code`
    - _Requirements: 6.2, 6.5_

- [x] 3. Repositories (data access + transactional audit writes)
  - [x] 3.1 Create subscriptionRepository
    - Create `apps/api/src/repositories/subscriptionRepository.ts` with plan lookups (`listActivePlans`, `findPlanById`), user subscription reads (`getStateForUser`), and transactional mutations (`insertGranted`, `markCancelled`, `patchSubscription`) that write the mutation and its `audit_logs` entry in one `db.transaction`, plus a query for expired active/granted subs for the sweep
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 13.1_
  - [x] 3.2 Create dataInspectorRepository
    - Create `apps/api/src/repositories/dataInspectorRepository.ts` with read-only, cursor-paginated queries for wall posts, community posts, and media metadata, plus a bounded conversation-window read; return tombstone markers for purged rows and never issue writes
    - _Requirements: 8.1, 8.3, 8.6, 9.1, 9.2_
  - [x] 3.3 Extend adminRepository for user lifecycle
    - Extend `apps/api/src/repositories/adminRepository.ts` with `createManualUser`, `updateEditableFields`, `changeRole`, `softDelete`, and email/domain lookup helpers — each mutation + `audit_logs` insert in one transaction; do not alter existing exported functions/signatures
    - _Requirements: 4.1, 4.3, 4.4, 5.2, 5.3, 5.5, 5.7, 13.1_
  - [ ]* 3.4 Write property test for pagination bounds and cursor consistency
    - **Property 20: Pagination is bounded and cursor-consistent**
    - **Validates: Requirements 8.1, 8.2, 9.1, 9.2, 13.4**
    - fast-check over arbitrary record counts/limits; assert returned count ≤ `min(limit,100)`, default 50, `nextCursor` present iff more records, audit list strictly reverse-chronological; ≥100 iterations; tag `// Feature: admin-control-center, Property 20`

- [x] 4. Subscription_Service
  - [x] 4.1 Implement deriveSubscriptionStatus pure helper
    - In `apps/api/src/services/subscriptionService.ts` implement `deriveSubscriptionStatus(subs, now)` returning `premium` iff a subscription with status in `{active, granted}` has null or future `current_period_end`, else `free`
    - _Requirements: 6.2, 6.3, 6.4, 6.7; Design "Authoritative-state → cache derivation"_
  - [ ]* 4.2 Write unit table tests for deriveSubscriptionStatus
    - Cover null expiry, future expiry, past expiry, cancelled/expired statuses, and empty set boundaries
    - _Requirements: 6.7_
  - [x] 4.3 Implement grant/revoke/change with cache sync
    - Implement `getForUser`, `grant`, `revoke`, `change`, `listPlans`; each mutation runs in one transaction that patches the authoritative `user_subscriptions` row, sets `users.subscription_status` via `deriveSubscriptionStatus`, and writes the `subscription.grant|revoke|change` audit entry; reject unknown/inactive plans and past `currentPeriodEnd` before any write
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6; Property 1, 2, 11_
  - [x] 4.4 Implement expiry sweep
    - Add `startExpirySweep`/`stopExpirySweep` (interval timer mirroring the existing `startBanSweeper`) that downgrades users whose active subscription `current_period_end` has passed and writes a system `subscription.auto_expire` audit entry with null actor
    - _Requirements: 6.7, 13.3; Property 1, 24_
  - [ ]* 4.5 Write property test for subscription cache invariant
    - **Property 1: Subscription cache always matches authoritative state**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.7**
    - Generate random op sequences (grant/revoke/change) + sweeps against in-memory repo; assert `subscription_status == deriveSubscriptionStatus(...)` after each op; ≥100 iterations; tag `// Feature: admin-control-center, Property 1`
  - [ ]* 4.6 Write property test for invalid privileged input rejection
    - **Property 11: Invalid privileged input is rejected without side effects**
    - **Validates: Requirements 4.2, 4.3, 6.5, 6.6, 12.5**
    - Generate unknown/inactive plans, past expiries, missing-reason destructive requests; assert descriptive error and zero rows changed; ≥100 iterations; tag `// Feature: admin-control-center, Property 11`
  - [ ]* 4.7 Write property test for system-action attribution
    - **Property 24: System-initiated actions are attributed to the system**
    - **Validates: Requirements 13.3**
    - Assert `subscription.auto_expire` (and `ban.auto_lift`) audit entries have null actor id and distinguishing action key; ≥100 iterations; tag `// Feature: admin-control-center, Property 24`

- [x] 5. Report_Context service
  - [x] 5.1 Implement report content resolution
    - Create `apps/api/src/services/reportContextService.ts` resolving a report into a `ReportContext` DTO by `target_type`: bounded transcript window for `message`, full text + media refs for `wall_post`/`wall_reply`/`community_post`, user summary + recent activity for `user`
    - _Requirements: 7.1, 7.2, 7.3, 7.4; Property 13_
  - [x] 5.2 Implement graceful unavailability and gated identity reveal
    - Return a defined `contentUnavailable` marker for removed/purged targets (no throw); restrict anonymity→identity resolution to `MODERATOR_ROLES` and write exactly one `context.identity_reveal` audit entry per successful reveal
    - _Requirements: 7.5, 7.6; Property 14, 15_
  - [ ]* 5.3 Write property test for report context resolution
    - **Property 13: Report context resolves the reported content correctly**
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - Generate reports of each target type incl. varying conversation lengths; assert correct resolution and transcript window within bound; ≥100 iterations; tag `// Feature: admin-control-center, Property 13`
  - [ ]* 5.4 Write property test for graceful degradation
    - **Property 14: Missing or purged content degrades gracefully**
    - **Validates: Requirements 7.6**
    - Generate reports whose targets are removed/purged; assert `contentUnavailable` returned and no throw; ≥100 iterations; tag `// Feature: admin-control-center, Property 14`
  - [ ]* 5.5 Write property test for gated, audited identity reveal
    - **Property 15: Identity reveal is moderator-gated and audited**
    - **Validates: Requirements 7.5**
    - Assert reveal only for `MODERATOR_ROLES` and exactly one `context.identity_reveal` audit per reveal; ≥100 iterations; tag `// Feature: admin-control-center, Property 15`

- [x] 6. Data_Inspector service
  - [x] 6.1 Implement read-only inspection surfaces
    - Create `apps/api/src/services/dataInspectorService.ts` with `listUsers` (reuse `adminRepository.listUsers`), `listWallPosts`, `listCommunityPosts`, `listMedia`, `listAudit` (reuse `moderationRepository.listAudit`); all read-only and paginated, surfacing tombstones for purged records
    - _Requirements: 8.1, 8.2, 8.6; Property 17, 19_
  - [x] 6.2 Implement scoped conversation inspection
    - Implement `inspectConversation` requiring `MODERATOR_ROLES` and a resolving `reportId` or `investigationContext`, returning a bounded transcript and writing exactly one `inspection.conversation` audit entry (actor, conversation key, associated report/investigation)
    - _Requirements: 8.3, 8.4; Property 16_
  - [x] 6.3 Implement short-lived signed media URLs
    - Implement `signMediaUrl` delegating to the media subsystem (`storage/`), returning a signed URL with a future `expiresAt` and never a permanent public URL
    - _Requirements: 8.5; Property 18_
  - [ ]* 6.4 Write property test for read-only inspection
    - **Property 17: Data inspection is read-only**
    - **Validates: Requirements 8.1, 8.2**
    - Run arbitrary read sequences against an instrumented in-memory repo; assert zero create/update/delete calls; ≥100 iterations; tag `// Feature: admin-control-center, Property 17`
  - [ ]* 6.5 Write property test for scoped message inspection
    - **Property 16: Message inspection requires moderator role and an explicit scope**
    - **Validates: Requirements 8.3, 8.4**
    - Generate role × scope combinations; assert content returned only for moderator+scope and exactly one `inspection.conversation` audit per success; ≥100 iterations; tag `// Feature: admin-control-center, Property 16`
  - [ ]* 6.6 Write property test for signed media URLs
    - **Property 18: Media is served only via short-lived signed URLs**
    - **Validates: Requirements 8.5**
    - Assert returned URL is signed with a future expiry, never permanent/public; ≥100 iterations; tag `// Feature: admin-control-center, Property 18`
  - [ ]* 6.7 Write property test for purged tombstones
    - **Property 19: Purged records surface as tombstones**
    - **Validates: Requirements 8.6**
    - Generate records flagged purged; assert tombstone indicator present and purged field values absent; ≥100 iterations; tag `// Feature: admin-control-center, Property 19`

- [x] 7. adminService extensions (user lifecycle, manual create, bulk, dashboard)
  - [x] 7.1 Implement manual user creation
    - Add `adminService.createUser(claims, input)`: validate name/`universityId` and email domain ∈ `universities.email_domains`; reject duplicate email (ConflictError); insert `users` row `account_status='pending_verification'`, `role='student'` with no credential link; write `user.create_manual` audit (`source='admin_manual'`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5; Property 10, 11_
  - [x] 7.2 Implement editable-field updates with verified-field guard
    - Add `adminService.editUser`: persist name/bio/avatar changes and write `user.edit` audit; reject any attempt to modify `university_id`/`branch_id`/`year` with a descriptive error and no change
    - _Requirements: 5.3, 5.4; Property 6_
  - [x] 7.3 Implement role change and soft delete with super_admin protection
    - Add `changeRole` (records `{from,to}` in `user.role_change` audit) and `softDelete` (sets `deleted_at`, performs Session_Teardown, schedules PII purge, writes `user.delete` audit); reject suspend/ban/delete/role-change targeting a `super_admin`; extend `setUserStatus` teardown coverage to soft delete
    - _Requirements: 5.2, 5.5, 5.6, 5.7; Property 7, 8_
  - [x] 7.4 Implement bulk actions
    - Add `adminService.bulkAction(claims, input)`: cap ≤100 targets, apply per target independently, return one `BulkActionResult` per input id, write exactly one audit per successfully affected target; require confirmation token for destructive variants and Super Admin for irreversible ones
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.2, 12.3; Property 12, 23_
  - [x] 7.5 Harden dashboard metrics and search/filter
    - Extend dashboard aggregation so a single failed metric returns a defined zero/unavailable value without failing the response; confirm case-insensitive name/email user search and report status-set filtering
    - _Requirements: 9.3, 9.4, 10.1, 10.3, 10.4; Property 21, 22_
  - [ ]* 7.6 Write property test for manual creation invariant
    - **Property 10: Manual creation yields a pending, student, verification-bound account**
    - **Validates: Requirements 4.1, 4.4**
    - Generate valid inputs incl. mixed-case emails/institutional domains; assert `pending_verification`, `role='student'`, no credential; ≥100 iterations; tag `// Feature: admin-control-center, Property 10`
  - [ ]* 7.7 Write property test for verified-field immutability
    - **Property 6: Verified fields are immutable through admin edits**
    - **Validates: Requirements 5.4**
    - Assert `university_id`/`branch_id`/`year` unchanged and edit rejected when targeted; ≥100 iterations; tag `// Feature: admin-control-center, Property 6`
  - [ ]* 7.8 Write property test for super_admin protection
    - **Property 7: Super Admins cannot be moderated, deleted, or re-roled by the flow**
    - **Validates: Requirements 5.6**
    - Assert suspend/ban/delete/role-change on a `super_admin` target is rejected and status/role unchanged; ≥100 iterations; tag `// Feature: admin-control-center, Property 7`
  - [ ]* 7.9 Write property test for session-teardown transitions
    - **Property 8: Suspend/ban/delete transitions force session teardown**
    - **Validates: Requirements 1.3, 5.2, 5.7**
    - Assert teardown (refresh revoke + disconnect signal) fires for suspended/banned/soft-deleted and not for active/restricted; ≥100 iterations; tag `// Feature: admin-control-center, Property 8`
  - [ ]* 7.10 Write property test for expired ban auto-lift
    - **Property 9: Expired temporary bans auto-lift on sweep**
    - **Validates: Requirements 1.4**
    - Generate bans with past/future/permanent `ends_at`; assert only past temporary bans lift and restore to `active`; ≥100 iterations; tag `// Feature: admin-control-center, Property 9`
  - [ ]* 7.11 Write property test for bulk per-target isolation
    - **Property 23: Bulk actions produce per-target results and isolate failures**
    - **Validates: Requirements 11.3**
    - Generate mixed valid/invalid id sets crossing the 100 boundary; assert one result per id, valid targets applied, failures isolated; ≥100 iterations; tag `// Feature: admin-control-center, Property 23`
  - [ ]* 7.12 Write property test for confirmation-gated destructive actions
    - **Property 12: No destructive action executes without confirmation**
    - **Validates: Requirements 11.4, 12.2**
    - Assert single/bulk destructive actions execute only with explicit confirmation, else rejected with no target affected; ≥100 iterations; tag `// Feature: admin-control-center, Property 12`
  - [ ]* 7.13 Write property test for search and status-filter soundness
    - **Property 21: Search and status filters are sound and complete**
    - **Validates: Requirements 9.3, 9.4**
    - Generate users/terms and reports/status-sets; assert exact case-insensitive name/email matches and exact status membership; ≥100 iterations; tag `// Feature: admin-control-center, Property 21`
  - [ ]* 7.14 Write property test for dashboard metric correctness/resilience
    - **Property 22: Dashboard metrics are correct and resilient**
    - **Validates: Requirements 10.1, 10.4**
    - Assert each count equals an independent recount and a single failing metric defaults while others return; ≥100 iterations; tag `// Feature: admin-control-center, Property 22`
  - [ ]* 7.15 Write property test for per-target audit accounting
    - **Property 2: Exactly one audit entry per affected target**
    - **Validates: Requirements 1.2, 4.5, 5.2, 5.3, 5.5, 6.2, 6.3, 6.4, 8.4, 11.1, 12.4, 13.1**
    - Across every mutating action (create/edit/role/delete/status/moderation/subscription/inspection/bulk), assert exactly one audit per affected target recording actor (or null), namespaced action key, target type/id, timestamp; ≥100 iterations; tag `// Feature: admin-control-center, Property 2`

- [x] 8. Checkpoint - service layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Authorization_Guard and session/access hardening middleware
  - [x] 9.1 Add requireActiveAccount and tiered role guards
    - Create `apps/api/src/middleware/requireActiveAccount.ts` (deny non-`active` accounts); use existing `requireRole` with `MODERATOR_ROLES`/`ADMIN_ROLES`/`SUPER_ADMIN_ROLES`; base all decisions solely on verified `req.auth` token claims (never body/query/headers)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 2.5; Property 3, 4_
  - [x] 9.2 Add permission-denied auditing on guard rejection
    - Create `apps/api/src/middleware/adminAudit.ts` `auditPermissionDenied` and wire it so an insufficient-role rejection on an admin route writes exactly one `access.permission_denied` audit before the 403, independent of the handler running
    - _Requirements: 3.6; Property 5_
  - [x] 9.3 Add admin rate limiter and hashed access logger
    - Create/extend `apps/api/src/middleware/rateLimiter.ts` with `adminRateLimiter` returning the standard 429 envelope; add `adminAccessLogger` writing an `admin.access` audit with a one-way hashed client address (never raw)
    - _Requirements: 14.1, 14.3, 14.4; Property 25_
  - [ ]* 9.4 Write property test for tiered authorization
    - **Property 3: Tiered authorization is enforced by role**
    - **Validates: Requirements 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 12.3, 14.1**
    - Generate role × route-tier × account-state combos; assert handler reached iff authenticated+active+role-satisfies-tier, else authorization error with no mutation; ≥100 iterations; tag `// Feature: admin-control-center, Property 3`
  - [ ]* 9.5 Write property test for client-input independence
    - **Property 4: Authorization decisions never depend on client input**
    - **Validates: Requirements 2.5, 3.5**
    - Inject `role`/`userId`/`isAdmin` into body/query/headers; assert identical authorization outcome vs. clean request; ≥100 iterations; tag `// Feature: admin-control-center, Property 4`
  - [ ]* 9.6 Write property test for permission-denied auditing
    - **Property 5: Permission-denied requests are audited**
    - **Validates: Requirements 3.6**
    - Assert exactly one `access.permission_denied` audit written before the error response on insufficient-role rejections; ≥100 iterations; tag `// Feature: admin-control-center, Property 5`
  - [ ]* 9.7 Write property test for hashed access addresses
    - **Property 25: Recorded admin access addresses are hashed**
    - **Validates: Requirements 14.4**
    - Assert stored client address is a one-way hash and never the raw address; ≥100 iterations; tag `// Feature: admin-control-center, Property 25`

- [x] 10. HTTP routes (extend existing, add new modules)
  - [x] 10.1 Extend admin.routes.ts for user lifecycle, subscriptions, context, bulk
    - In `apps/api/src/http/admin.routes.ts` add tier-guarded routes with Zod validation and pagination parsing: `POST /admin/users`, `PATCH /admin/users/:id`, `PATCH /admin/users/:id/role`, `DELETE /admin/users/:id`, `GET /admin/users/:id/subscription`, `POST /admin/users/:id/subscription/grant`, `POST /admin/users/:id/subscription/revoke`, `PATCH /admin/users/:id/subscription`, `GET /admin/subscription-plans`, `GET /admin/reports/:id/context`, `POST /admin/bulk-actions`; preserve all existing routes/contracts/gating
    - _Requirements: 4, 5.3, 5.5, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7, 11, 12_
  - [x] 10.2 Add inspector route module
    - Create `apps/api/src/http/adminInspector.routes.ts` with `GET /admin/inspector/(posts|community-posts|media)` (Admin), `POST /admin/inspector/conversation` (Moderator), `GET /admin/inspector/media/:id/url` (Admin); mount under `/admin` behind `requireAuth` and the guard chain
    - _Requirements: 8.1, 8.3, 8.4, 8.5_
  - [x] 10.3 Wire guard chain, rate limiter, access logger, and sweeps into the app
    - Apply `requireActiveAccount` + tiered `requireRole` + `adminRateLimiter` + `adminAccessLogger` to the admin router in `apps/api/src/app.ts`; start `subscriptionService.startExpirySweep()` alongside the existing ban sweeper
    - _Requirements: 3.1–3.6, 6.7, 14.1, 14.3, 14.4_
  - [ ]* 10.4 Write integration tests for contract preservation and hardening
    - Assert existing admin/moderation request/response contracts are unchanged (Req 1.1), rate limiting returns 429 envelope (14.3), and the app issues only INSERT/SELECT on `audit_logs` (append-only, 13.2)
    - _Requirements: 1.1, 13.2, 14.3_

- [x] 11. Checkpoint - backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Web Admin Console — guarded shell and UI primitives
  - [x] 12.1 Add missing UI primitives
    - Add to `apps/web/components/ui/` only primitives not already present (Badge, Dialog, Select, Table) following the `Button.tsx` pattern: `forwardRef`, named export, `displayName`, `className` merged via `cn()`, CVA variants, semantic tokens, `lucide-react` icons, ≥44px targets, visible focus ring
    - _Requirements: 15.1, 15.2, 15.4_
  - [x] 12.2 Create guarded admin layout without AppNav
    - Create `apps/web/app/admin/layout.tsx` using `useRequireAuth`: redirect unauthenticated to sign-in, redirect authenticated-but-non-`MODERATOR_ROLES` to `/` without rendering admin content; render no `AppNav`; treat client gating as presentation only
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [x] 12.3 Create AdminShell and shared admin components
    - Create `apps/web/components/admin/AdminShell.tsx` (sidebar, `lucide-react` icons, tier-aware links), `ConfirmDialog.tsx` (names action/target/reversibility + reason field, CVA), `DataTable.tsx` (cursor "load more"), `StatCard.tsx`; use relative imports, semantic tokens, `cn()`
    - _Requirements: 12.1, 15.1, 15.2, 15.3, 15.4_
  - [x] 12.4 Extend web admin API client
    - Extend `apps/web/lib/admin.ts` with typed calls for the new endpoints (subscriptions, user lifecycle, report context, inspector, bulk actions) importing DTOs from `@campusly/shared-types`; keep existing client functions unchanged
    - _Requirements: 4, 5, 6, 7, 8, 11_

- [x] 13. Web Admin Console — pages
  - [x] 13.1 Build dashboard page
    - Rework `apps/web/app/admin/page.tsx` into the dashboard using `StatCard`s; display pending report count as a distinct safety-priority indicator
    - _Requirements: 10.1, 10.2_
  - [x] 13.2 Build reports page with context drawer
    - Create `apps/web/app/admin/reports/page.tsx`: report queue with status filter and a Report_Context drawer rendering resolved content/transcript and `contentUnavailable` state
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 9.4_
  - [x] 13.3 Build users page (list/search/filter, lifecycle, manual create, subscription panel)
    - Create `apps/web/app/admin/users/page.tsx`: paginated searchable list, status/role/edit/delete actions via `ConfirmDialog` for destructive ones, manual-create form, and per-user subscription grant/revoke/change panel
    - _Requirements: 4, 5, 6, 9.1, 9.2, 9.3, 12.1_
  - [x] 13.4 Build subscriptions, inspector, and audit pages
    - Create `apps/web/app/admin/subscriptions/page.tsx`, `apps/web/app/admin/inspector/page.tsx` (read-only records + scoped conversation view + signed media links), and `apps/web/app/admin/audit/page.tsx` (reverse-chronological cursor-paginated audit list)
    - _Requirements: 6.1, 8.1, 8.2, 8.3, 8.5, 13.4_
  - [x] 13.5 Remove admin link from main student navigation
    - Remove any admin entry point from `apps/web/components/AppNav.tsx` (and any other main-nav surface) so the admin area is unreachable from student navigation
    - _Requirements: 2.2_

- [ ] 14. Web Admin Console — tests
  - [ ]* 14.1 Write layout guard and no-AppNav tests
    - Assert unauthenticated redirect to sign-in (2.4), non-privileged redirect to `/` without admin content (2.3), no `AppNav` rendered (2.1), and no admin link in main nav (2.2)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 14.2 Write theme and accessibility tests
    - Light/dark theme snapshots changing only color not layout (15.3); axe a11y checks plus accessible-name, ≥44px touch-target, and visible-focus assertions (15.4)
    - _Requirements: 15.3, 15.4_

- [x] 15. Migration apply and full verification
  - [x] 15.1 Apply migration in a disposable database and run seed
    - Run `drizzle-kit migrate` (and the plan seed) against a disposable/throwaway database to confirm `subscription_plans`, `user_subscriptions`, `subscription_transactions`, indexes, and seed apply cleanly
    - _Requirements: 6_
  - [x] 15.2 Run typecheck, lint, and test suites
    - Run `pnpm --filter @campusly/api test` and `typecheck`, and `pnpm --filter @campusly/web typecheck` and `lint`; ensure all property tests pass at ≥100 iterations
    - _Requirements: all_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement clauses and/or Correctness Properties for traceability.
- Property-based tests use `fast-check` at ≥100 iterations, backed by in-memory/mocked repositories (media signer and `notifier` mocked), tagged `// Feature: admin-control-center, Property N`.
- All existing admin/moderation contracts and behavior are preserved; tasks touching existing files (`admin.routes.ts`, `adminService`, `adminRepository`, `lib/admin.ts`, `AppNav.tsx`, `app.ts`, `schema.ts`) extend rather than replace them.
- Web code uses relative imports, `cn()`, semantic Tailwind tokens, CVA variant primitives, and `lucide-react`, per project standards.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "4.1", "5.1", "6.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "5.2", "6.2", "6.3", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6", "4.7", "5.3", "5.4", "5.5", "6.4", "6.5", "6.6", "6.7", "7.4", "7.5"] },
    { "id": 7, "tasks": ["7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "7.14", "7.15"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 9, "tasks": ["9.4", "9.5", "9.6", "9.7", "10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3"] },
    { "id": 11, "tasks": ["10.4", "12.1", "12.4"] },
    { "id": 12, "tasks": ["12.2", "12.3"] },
    { "id": 13, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 14, "tasks": ["14.1", "14.2", "15.1"] },
    { "id": 15, "tasks": ["15.2"] }
  ]
}
```
