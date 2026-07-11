# Requirements Document

## Introduction

The Admin Control Center is an enhancement of Campusly V2's existing administration surface. It gives platform operators (Moderator, Platform Admin, Super Admin) stronger, safer, and more usable control over the platform from a **separate, admin-only area** — never surfaced in the main student navigation.

The feature extends the current admin implementation (`apps/api/src/http/admin.routes.ts`, `apps/api/src/services/adminService.ts`, `apps/api/src/repositories/adminRepository.ts`, `apps/web/lib/admin.ts`, and the `/admin` web route) rather than replacing it. All currently implemented moderation, report-queue, user-status, feature-flag, announcement, and audit-log behavior is preserved and remains backward compatible.

Scope of new/enhanced capability:
1. Preserve existing moderation and report-queue actions.
2. Manual user management (create users; full lifecycle control over existing users).
3. Per-user subscription control (grant / revoke / upgrade tier and expiry).
4. Platform data inspection (users, posts, messages/chats where policy allows, media, audit trail) within privacy boundaries.
5. Reports shown **with context** (the reported transcript / feedback content, not just an identifier).
6. Cross-cutting admin improvements: admin-action audit logging, search/filter, pagination, dashboards/metrics, bulk actions, and safety confirmations for destructive operations.

The document distinguishes **PRESERVE** (already implemented) from **NEW/ENHANCED** capability, and grounds every requirement in the authoritative docs (`ADMIN_PANEL.md`, `DATABASE_SCHEMA.md`, `AUTH_SYSTEM.md`, `SECURITY.md`). Where a capability is not covered by the docs, it is flagged in "Documentation Alignment & Flags" below and must be resolved before implementation, per the standing rule that implementation strictly follows `/docs`.

---

## Documentation Alignment & Flags

This section is **non-normative** (it contains no acceptance criteria). It records where the requested capabilities align with, extend, or diverge from the authoritative documentation. These items should be resolved during design and reflected back into `/docs`.

- **FLAG 1 — Subscriptions are documented but NOT implemented (correction to the task brief).** The task brief states subscriptions appear undocumented. That is not the case: `DATABASE_SCHEMA.md` §17 fully specifies the Subscription Module (`subscription_plans`, `user_subscriptions`, `subscription_transactions`, with `source` including `admin_grant`), and `ADMIN_PANEL.md` §8 specifies admin Subscription Management (view / grant / remove / global toggle). What is missing is the **implementation**: the current Drizzle schema (`apps/api/src/db/schema.ts`) only has a denormalized `subscription_status` enum (`free` / `premium`) cached on `users`; the three subscription tables do not exist yet. Per-user subscription control is therefore **NEW implementation of an already-documented design**, not a new undocumented domain. No documentation change is required for the core subscription model; a migration implementing §17 is required. Any capability beyond §17 (e.g., admin "upgrade tier" across multiple premium tiers) depends on `subscription_plans` rows and must align with `FEATURE_MATRIX.md` §14.

- **FLAG 2 — Manual user creation is undocumented and conflicts with the onboarding model.** `ADMIN_PANEL.md` §4 lists View / Search / Suspend / Ban / Restore / Delete / View History, but does **not** include manual user creation. `AUTH_SYSTEM.md` §1–3 mandates that accounts are created only via Google OAuth against a recognized institutional email domain (one verified account per institutional email, no passwords). Admin-initiated manual creation therefore conflicts with the verified-student model and requires a product decision and a doc update (`ADMIN_PANEL.md` §4 and `AUTH_SYSTEM.md`) before implementation. Requirement 5 captures the least-divergent interpretation (create a `pending_verification` record bound to a recognized institutional email that must still complete Google verification) and marks the behavior as pending confirmation.

- **FLAG 3 — Message / chat content inspection is privacy-bounded.** `SECURITY.md` §4 restricts message access to conversation participants; `AUTH_SYSTEM.md` §9 reserves the anonymity→identity link for moderators only; `ADMIN_PANEL.md` §11 states analytics never expose individual private content. Documented data access is **report-driven and context-scoped** (`ADMIN_PANEL.md` §5 "Review Report", §7 "Investigate Sessions" — moderators only), not free-form browsing of arbitrary private conversations. Requirement 8 scopes message/chat inspection to reported/investigated context and audit-logs every access, rather than granting open transcript browsing. Broadening this would require a `SECURITY.md` / `AUTH_SYSTEM.md` change.

- **FLAG 4 — "Change role" and "edit user" are constrained.** `AUTH_SYSTEM.md` §4/§7 and `ADMIN_PANEL.md` §2 reserve managing admin roles for Super Admin only, and `AUTH_SYSTEM.md` §8 states verified fields (university/branch/year) are not freely editable. Requirement 5 constrains role changes and field edits accordingly rather than granting unrestricted "full control".

- **FLAG 5 — Existing web `/admin` route renders the main `AppNav`.** `apps/web/app/admin/page.tsx` currently includes `<AppNav />`, which surfaces the student navigation inside the admin area. The requested UX constraint (admin experience must be a separate, admin-only area not linked from the main app navigation) requires removing the main-nav entry point and giving the admin area its own guarded shell (Requirement 2).

---

## Glossary

- **Admin_Control_Center**: The complete administration feature (backend admin services/routes plus the admin-only web area) governing moderation, user management, subscriptions, data inspection, and platform operation.
- **Admin_Console**: The admin-only web area under the `/admin` route in `apps/web`, rendered in its own guarded layout, separate from the student application shell.
- **Admin_API**: The backend admin and moderation services and routes (`adminService`, `adminRepository`, `admin.routes.ts`) in `apps/api`.
- **Authorization_Guard**: The server-side RBAC enforcement (role + account-state) applied to every Admin_API route, independent of the UI.
- **Audit_Log**: The immutable, append-only accountability ledger (`audit_logs`, `DATABASE_SCHEMA.md` §15.7) recording privileged actions.
- **Subscription_Service**: The Admin_API component that manages `subscription_plans`, `user_subscriptions`, and the denormalized `users.subscription_status` cache (`DATABASE_SCHEMA.md` §17).
- **Data_Inspector**: The Admin_API component that returns platform records (users, posts, messages, media, audit entries) for administrative review within privacy boundaries.
- **Report_Context**: The bundle of reported content plus its surrounding context (e.g., chat transcript, reported post/reply text, feedback content) attached to a report for review.
- **Operator**: Any user with a privileged role — Moderator, Platform Admin (`admin`), or Super Admin (`super_admin`).
- **Moderator_Role**: A user whose `role` is in `{moderator, admin, super_admin}` (the `MODERATOR_ROLES` set).
- **Admin_Role**: A user whose `role` is in `{admin, super_admin}` (the `ADMIN_ROLES` set).
- **Super_Admin**: A user whose `role` is `super_admin`.
- **Destructive_Action**: An admin operation that is irreversible or high-blast-radius: account deletion, permanent ban, role change, subscription revocation, and any bulk variant of these.
- **Session_Teardown**: Revoking a user's refresh tokens and disconnecting their active sockets (`AUTH_SYSTEM.md` §6).

---

## Requirements

### Requirement 1: Preserve existing moderation and report-queue capabilities

**User Story:** As an Operator, I want all currently implemented moderation and report-queue actions to keep working exactly as before, so that upgrading the admin panel introduces no regression in safety operations.

**Status:** PRESERVE (already implemented in `adminService`, `admin.routes.ts`, `apps/web/app/admin/page.tsx`).

#### Acceptance Criteria

1. THE Admin_API SHALL continue to expose the report queue, report status resolution, graduated moderation actions (`hide_content`, `remove_content`, `warn`, `restrict`, `ban`, `dismiss`), appeal listing, and appeal resolution with the existing request and response contracts defined in `@campusly/shared-types`.
2. WHEN an Operator resolves a report or applies a moderation action, THE Admin_API SHALL write an Audit_Log entry recording actor, action, target type, and target identifier.
3. WHEN a moderation action sets a user's `account_status` to `suspended` or `banned`, THE Admin_API SHALL perform Session_Teardown for that user.
4. WHILE a temporary ban's `ends_at` is in the past, THE Admin_API SHALL auto-lift the ban and restore the affected user to `active` on the next sweep cycle.
5. THE Admin_Console SHALL continue to present the report queue to any Operator holding a Moderator_Role.

### Requirement 2: Admin-only separated area with route guarding

**User Story:** As a platform owner, I want the admin experience to live in a separate admin-only area that is not linked from the main student navigation, so that regular students never see or reach administrative surfaces.

**Status:** NEW/ENHANCED (removes main-nav coupling described in FLAG 5).

#### Acceptance Criteria

1. THE Admin_Console SHALL render in a dedicated admin layout that does not include the student application navigation component.
2. THE Admin_Console SHALL omit any link, menu item, or button that points to the admin area from the main student navigation.
3. WHEN a user whose `role` is not in the Moderator_Role set requests any Admin_Console route, THE Admin_Console SHALL redirect the user away from the admin area without rendering administrative content.
4. WHEN an unauthenticated visitor requests any Admin_Console route, THE Admin_Console SHALL redirect the visitor to the sign-in surface.
5. THE Admin_Console SHALL treat client-side gating as presentation only and SHALL rely on the Authorization_Guard for all access decisions.

### Requirement 3: Role-tiered server-side authorization

**User Story:** As a security owner, I want every administrative operation gated by role and account state on the server, so that access cannot be obtained by manipulating the client.

**Status:** PRESERVE + ENHANCED (extends existing `requireRole` gating to new routes).

#### Acceptance Criteria

1. THE Authorization_Guard SHALL require an authenticated, `active` account for every Admin_API route.
2. WHERE an Admin_API route exposes a moderation surface, THE Authorization_Guard SHALL require a Moderator_Role.
3. WHERE an Admin_API route exposes user management, subscription, feature-flag, announcement, analytics, or data-inspection surfaces, THE Authorization_Guard SHALL require an Admin_Role.
4. WHERE an Admin_API route manages platform roles or executes an irreversible platform action, THE Authorization_Guard SHALL require the Super_Admin role.
5. IF a request lacks the role required for a route, THEN THE Authorization_Guard SHALL reject the request with an authorization error and SHALL NOT perform the requested operation.
6. WHEN the Authorization_Guard rejects a privileged request, THE Admin_API SHALL record a permission-denied entry in the Audit_Log.

### Requirement 4: Manual user creation (flagged)

**User Story:** As an Admin_Role Operator, I want to create a user account manually, so that I can onboard accounts that cannot complete standard self-service sign-in.

**Status:** NEW — UNDOCUMENTED; pending product decision and doc update (see FLAG 2). Acceptance criteria describe the least-divergent behavior consistent with `AUTH_SYSTEM.md`.

#### Acceptance Criteria

1. WHEN an Admin_Role Operator submits a manual user creation request, THE Admin_API SHALL require a name, an email whose domain matches a recognized institutional domain in `universities.email_domains`, and a `university_id`.
2. IF the submitted email domain does not match a recognized institutional domain, THEN THE Admin_API SHALL reject the request with a descriptive validation error and SHALL NOT create a user.
3. IF the submitted email already belongs to an existing account, THEN THE Admin_API SHALL reject the request with a descriptive conflict error and SHALL NOT create a duplicate account.
4. WHEN a manual user creation request is valid, THE Admin_API SHALL create a user record with `account_status = pending_verification` and `role = student`, requiring completion of Google verification before the account becomes `active`.
5. WHEN a user is created manually, THE Admin_API SHALL write an Audit_Log entry recording the acting Operator, the created user identifier, and the creation source.

### Requirement 5: Existing-user lifecycle management

**User Story:** As an Admin_Role Operator, I want full lifecycle control over existing users, so that I can view, edit permitted fields, change status, change roles within policy, and delete accounts.

**Status:** PRESERVE (view, search, suspend, ban, restore) + NEW/ENHANCED (edit permitted fields, role change, delete), constrained per FLAG 4.

#### Acceptance Criteria

1. THE Admin_API SHALL return a paginated list of users and a per-user history (warnings, bans, recent actions, report counts) to Admin_Role Operators, preserving the existing `AdminUser` and `UserHistory` contracts.
2. WHEN an Admin_Role Operator sets a user's status to `active`, `restricted`, `suspended`, or `banned`, THE Admin_API SHALL apply the status, perform Session_Teardown for `suspended` or `banned`, and write an Audit_Log entry.
3. WHEN an Admin_Role Operator edits an editable profile field (name, bio, avatar) of a user, THE Admin_API SHALL persist the change and write an Audit_Log entry.
4. IF an edit request targets a verified field (`university_id`, `branch_id`, or `year`), THEN THE Admin_API SHALL reject the edit with a descriptive error and SHALL NOT modify the verified field.
5. WHERE a role change is requested, THE Authorization_Guard SHALL require the Super_Admin role, and THE Admin_API SHALL record the previous role, the new role, and the acting Operator in the Audit_Log.
6. IF any Operator attempts to suspend, ban, delete, or change the role of a Super_Admin, THEN THE Admin_API SHALL reject the request with a descriptive error.
7. WHEN a Super_Admin deletes a user account, THE Admin_API SHALL soft-delete the account, perform Session_Teardown, schedule PII purge per the retention policy, and write an Audit_Log entry.

### Requirement 6: Per-user subscription control

**User Story:** As an Admin_Role Operator, I want to view and control a user's subscription, so that I can grant, revoke, or change a user's premium entitlement and its expiry.

**Status:** NEW implementation of documented design (`DATABASE_SCHEMA.md` §17, `ADMIN_PANEL.md` §8); requires implementing the subscription tables (see FLAG 1).

#### Acceptance Criteria

1. THE Subscription_Service SHALL return a user's current subscription state including plan, status, source, and `current_period_end` to Admin_Role Operators.
2. WHEN an Admin_Role Operator grants a subscription to a user with a target plan and expiry, THE Subscription_Service SHALL create a `user_subscriptions` record with `source = admin_grant` and `status = granted`, set the requested `current_period_end`, synchronize `users.subscription_status` to `premium`, and write an Audit_Log entry.
3. WHEN an Admin_Role Operator revokes a user's active subscription, THE Subscription_Service SHALL mark the subscription `cancelled`, synchronize `users.subscription_status` to `free`, and write an Audit_Log entry.
4. WHEN an Admin_Role Operator changes a user's subscription plan or expiry, THE Subscription_Service SHALL update the authoritative `user_subscriptions` record, synchronize `users.subscription_status`, and write an Audit_Log entry.
5. IF a grant or change request specifies an inactive or unknown plan, THEN THE Subscription_Service SHALL reject the request with a descriptive error and SHALL NOT modify the user's subscription.
6. IF a grant or change request specifies an expiry earlier than the current time, THEN THE Subscription_Service SHALL reject the request with a descriptive error.
7. WHILE a user's active subscription `current_period_end` is in the past, THE Subscription_Service SHALL downgrade `users.subscription_status` to `free` on the next expiry sweep and write an Audit_Log entry.

### Requirement 7: Reports displayed with context

**User Story:** As an Operator reviewing a report, I want to see the reported content and its surrounding context, so that I can make an informed decision without looking up identifiers manually.

**Status:** NEW/ENHANCED (extends existing report queue with Report_Context).

#### Acceptance Criteria

1. WHEN an Operator opens a report, THE Report_Context SHALL return the report metadata together with the reported content resolved from its `target_type` and `target_id`.
2. WHERE the report target is a `message`, THE Report_Context SHALL return the reported message and a bounded window of surrounding messages from the same conversation as the transcript context.
3. WHERE the report target is a `wall_post`, `wall_reply`, or `community_post`, THE Report_Context SHALL return the full text and media references of the reported content.
4. WHERE the report target is a `user`, THE Report_Context SHALL return the reported user's summary and recent reportable activity relevant to the report.
5. WHEN Report_Context resolves the verified author of anonymous reported content, THE Report_Context SHALL restrict that resolution to Operators holding a Moderator_Role and SHALL write an Audit_Log entry recording the context access.
6. IF the reported content has been removed or purged, THEN THE Report_Context SHALL return a defined "content unavailable" indicator instead of failing.

### Requirement 8: Platform data inspection within privacy boundaries

**User Story:** As an Admin_Role Operator, I want to inspect platform data (users, posts, messages within policy, media, and the audit trail), so that I can investigate issues and operate the platform, without violating student privacy.

**Status:** NEW/ENHANCED, privacy-bounded per FLAG 3.

#### Acceptance Criteria

1. THE Data_Inspector SHALL provide Admin_Role Operators paginated, read-only access to user records, wall posts, community posts, and media asset metadata.
2. THE Data_Inspector SHALL provide Admin_Role Operators paginated, read-only access to the Audit_Log.
3. WHERE the requested data is private message or chat content, THE Data_Inspector SHALL restrict access to Operators holding a Moderator_Role and SHALL scope the returned content to a report or investigation context rather than open browsing.
4. WHEN the Data_Inspector returns private message or chat content, THE Data_Inspector SHALL write an Audit_Log entry recording the acting Operator, the inspected conversation, and the associated report or investigation.
5. WHEN the Data_Inspector serves a media asset, THE Admin_API SHALL issue a short-lived signed URL and SHALL NOT expose a permanent public URL.
6. THE Data_Inspector SHALL exclude fields already hard-purged under the retention policy and SHALL present a tombstone indicator for purged records.

### Requirement 9: Search, filtering, and pagination

**User Story:** As an Operator, I want to search, filter, and page through large lists, so that I can find relevant records efficiently.

**Status:** PRESERVE (cursor pagination and user search exist) + ENHANCED (filters).

#### Acceptance Criteria

1. WHEN an Operator requests a list of users, reports, or audit entries, THE Admin_API SHALL return results in pages of at most 100 records, defaulting to 50 records per page.
2. THE Admin_API SHALL return a `nextCursor` value when additional records exist beyond the current page, and SHALL return a null cursor when no further records exist.
3. WHEN an Operator supplies a user search term, THE Admin_API SHALL return users whose name or email matches the term, case-insensitively.
4. WHERE an Operator supplies a status filter for the report queue, THE Admin_API SHALL return only reports whose status is in the requested set.
5. IF a requested page size exceeds 100, THEN THE Admin_API SHALL reject the request with a descriptive validation error.

### Requirement 10: Dashboard and operational metrics

**User Story:** As an Operator, I want an at-a-glance dashboard, so that I can triage platform health and safety priorities quickly.

**Status:** PRESERVE + ENHANCED (`ADMIN_PANEL.md` §3).

#### Acceptance Criteria

1. WHEN an Admin_Role Operator opens the dashboard, THE Admin_API SHALL return total users, active users, pending report count, posts created today, community count, and premium user count.
2. THE Admin_Console SHALL display the pending report count as a distinct safety-priority indicator.
3. THE Admin_API SHALL derive dashboard counts from lightweight aggregate queries rather than per-request scans of high-volume content tables.
4. IF a dashboard metric cannot be computed, THEN THE Admin_API SHALL return a defined zero or unavailable value for that metric instead of failing the entire dashboard response.

### Requirement 11: Bulk actions

**User Story:** As an Admin_Role Operator, I want to apply an action to multiple selected records at once, so that I can operate efficiently at scale.

**Status:** NEW.

#### Acceptance Criteria

1. WHEN an Admin_Role Operator submits a bulk action over a set of target identifiers, THE Admin_API SHALL apply the action to each valid target and SHALL write one Audit_Log entry per affected target.
2. THE Admin_API SHALL limit a single bulk action to at most 100 target identifiers per request.
3. IF one or more targets in a bulk action fail, THEN THE Admin_API SHALL apply the action to the remaining valid targets and SHALL return a per-target result indicating success or failure for each.
4. WHERE a bulk action includes a Destructive_Action, THE Admin_API SHALL require an explicit confirmation token in the request before executing.

### Requirement 12: Destructive-action safeguards

**User Story:** As a platform owner, I want destructive administrative actions to require deliberate confirmation and appropriate privilege, so that irreversible mistakes are prevented.

**Status:** NEW (`ADMIN_PANEL.md` §13, `SECURITY.md`).

#### Acceptance Criteria

1. WHEN an Operator initiates a Destructive_Action, THE Admin_Console SHALL present a confirmation step that names the action, the target, and its reversibility before the action is submitted.
2. WHEN a Destructive_Action request reaches the Admin_API, THE Admin_API SHALL require an explicit confirmation indicator and SHALL reject the request if the indicator is absent.
3. WHERE a Destructive_Action is irreversible, THE Authorization_Guard SHALL require the Super_Admin role.
4. WHEN a Destructive_Action completes, THE Admin_API SHALL write an Audit_Log entry that includes the action, target, acting Operator, and the reason supplied.
5. IF a required reason is missing for a Destructive_Action that mandates one, THEN THE Admin_API SHALL reject the request with a descriptive error.

### Requirement 13: Audit logging of administrative actions

**User Story:** As an accountability owner, I want every privileged administrative action recorded immutably, so that operators are themselves accountable and incidents are investigable.

**Status:** PRESERVE + ENHANCED (`DATABASE_SCHEMA.md` §15.7, `ADMIN_PANEL.md` §12).

#### Acceptance Criteria

1. WHEN any user-management, moderation, subscription, feature-flag, announcement, or data-inspection operation succeeds, THE Admin_API SHALL append an Audit_Log entry recording actor identifier, action key, target type, target identifier, and timestamp.
2. THE Audit_Log SHALL be append-only and SHALL NOT permit update or deletion of entries within the retention window.
3. THE Admin_API SHALL record system-initiated privileged actions with a null actor identifier and a distinguishing action key.
4. WHEN an Admin_Role Operator views the Audit_Log, THE Admin_API SHALL return entries in reverse chronological order with cursor pagination.
5. THE Admin_API SHALL exclude secrets and unnecessary personally identifying data from Audit_Log entry metadata.

### Requirement 14: Admin session and access hardening

**User Story:** As a security owner, I want administrative access hardened beyond ordinary sessions, so that the highest-privilege surface has the strongest protection.

**Status:** NEW/ENHANCED (`ADMIN_PANEL.md` §13, `SECURITY.md`). Proposed idle-timeout value is pending confirmation.

#### Acceptance Criteria

1. THE Admin_API SHALL validate the access token signature, expiry, role claim, and account state on every admin request.
2. WHILE an Operator's admin session has been idle beyond the configured admin idle-timeout, THE Admin_Console SHALL require re-authentication before permitting further administrative actions.
3. THE Admin_API SHALL apply rate limiting to administrative endpoints to deter automated abuse.
4. WHEN an Operator accesses the Admin_Console, THE Admin_API SHALL record the access with a hashed client address and context for anomaly detection.

### Requirement 15: Design-system and accessibility consistency

**User Story:** As an Operator, I want the admin area to follow the project's design system, so that the experience is consistent, themable, and accessible.

**Status:** NEW/ENHANCED (`.kiro/steering/figma-design-system.md`, `UI_GUIDELINES.md`).

#### Acceptance Criteria

1. THE Admin_Console SHALL compose styles using the project semantic Tailwind tokens and the `cn()` helper, and SHALL NOT use hardcoded color values.
2. THE Admin_Console SHALL reuse existing UI primitives from `components/ui/` before introducing new primitives, and SHALL use `lucide-react` for icons.
3. THE Admin_Console SHALL render correctly in both light and dark themes using semantic color tokens, changing only color and not layout between themes.
4. THE Admin_Console SHALL provide accessible names for interactive controls, maintain a minimum 44px touch target for inputs and buttons, and preserve visible focus styles.
