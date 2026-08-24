# Security

## Auth Module Overview

Authentication uses a **JWT + server-side session hybrid**:

- JWT stored in an `httpOnly`, `secure`, `sameSite=strict` cookie (8-hour expiry)
- JWT payload includes `token_version` (invalidates all tokens on password change / logout-all) and `sid` (session ID for per-device revocation)
- Every authenticated request validates the JWT signature, checks `token_version` against the DB, and verifies the session's `is_active` flag

---

## Password Authentication

1. User submits email + password
2. Rate limit check (per IP + email hash)
3. User lookup via `findUserByEmail` — must have `password_hash` and `email_verified=true`
4. Password verified with `argon2.verify` (timing-safe)
5. On success: session created, JWT issued, login event recorded
6. On failure: `recordLoginAttempt` (for lockout), auth event logged

**Timing attack mitigation:** If user not found or rate-limited, `verifyPassword(DUMMY_HASH, password)` is always called to keep response time consistent.

**Lockout — two independent counters:**

- **Per source (IP + email hash):** 5 failures within 15 minutes → locked for that IP+email pair
- **Per email (all IPs):** 20 failures within 60 minutes → locked for that email regardless of IP (credential-stuffing detection)

Both counters use the same `login_attempts` table. On either threshold hit, DUMMY_HASH verify runs and 401 is returned (identical shape — no enumeration leak).

**Stale attempt purge:** `purgeStaleAttempts` runs probabilistically (~1% of login requests) as fire-and-forget — keeps the table small without adding latency to every login.

---

## Password Hashing

- Algorithm: **Argon2id** via the `argon2` library
- Parameters (OWASP 2024 baseline): `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`
- Applied on: account activation, password change, password reset
- Minimum length: 8 characters. Maximum: 128 characters.
- `DUMMY_HASH` is a **pre-computed compile-time constant** (same parameters) — never regenerated at runtime. Used in every rejected login path so response time is indistinguishable from a real verify.

---

## JWT

```
Payload: { id, email, role, name, department_id, token_version, sid }
Secret: process.env.JWT_SECRET (HS256) — required, ≥32 chars. Generate: openssl rand -base64 32
Expiry: 8 hours
Transport: httpOnly cookie named "session"
```

**Boot validation:** If `JWT_SECRET` is missing or under 32 characters, the server logs a FATAL error and exits.

**Portal tokens use a separate secret entirely** (`PORTAL_JWT_SECRET`, same length/validation rule) — see §13.14. This is not the same trust boundary as staff auth and must never share a secret with it.

### JWT_SECRET rotation

Set `JWT_SECRET_PREVIOUS` (optional) to the old secret. `verifyToken` tries the current secret first, falls back to previous. New tokens are always signed with the current secret.

Rotation procedure:

1. Deploy with both `JWT_SECRET` (new) and `JWT_SECRET_PREVIOUS` (old) set
2. Wait one `JWT_EXPIRES_IN` period (8 hours) so all old tokens expire
3. Remove `JWT_SECRET_PREVIOUS` and redeploy

**Token version:** Incremented on `logout-all`, password change, password reset, **admin-initiated role change** (`PATCH /users/:id` with a `role` different from the current one), and **user soft-delete** (`DELETE /users/:id`). Middleware rejects any token with a stale version by comparing the JWT's `tokenVersion` claim against the **live** `users.token_version` column (`getSessionWithTokenVersion`, joined per request or from the 30s cache below) — fixed in Phase 20 (UPGRADE.md F-1); previously the comparison was against the same claim decoded from the token itself and could never fail. The role-change/delete bump closes a gap where `requireAuth` trusts the JWT's `role` claim: without it, a demoted or deleted user's still-valid JWT would keep its old role/access for up to the token's remaining 8-hour lifetime. Both are implemented in `users/service.ts` (`update`/`softDelete`, inside the same transaction as the role/deletion write, via `authRepo.incrementTokenVersion`).

**Session ID (`sid`):** Every login/magic-link creates a row in `user_sessions`. Middleware calls `getSessionWithTokenVersion(sid)` and rejects if `is_active=FALSE` **or if `session.user_id !== JWT payload id`** (prevents a stolen JWT with a swapped `sid` from passing). Single-device logout only sets that session's `is_active=FALSE` without touching the token version.

---

## Session Management

Table: `user_sessions`

| Column         | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| id             | UUID, session identifier (stored in JWT as `sid`)                          |
| user_id        | Owner                                                                      |
| browser / os   | Parsed from User-Agent                                                     |
| ip             | Client IP from `getRealIp()`                                               |
| city / country | From geo provider (see Geo Lookup section)                                 |
| last_used_at   | Updated at most once per 60 s (`touchSession` throttled + fire-and-forget) |
| is_active      | Set to FALSE on revoke                                                     |

**`touchSession` throttle:** An in-memory `Map<sid, lastTouchedMs>` skips the DB UPDATE if the same session was touched within the last 60 seconds. The map is capped at 10 000 entries with simple insertion-order eviction (oldest removed when full).

**Session cap:** Each user may have at most 10 active sessions. `createSession` evicts the session with the oldest `last_used_at` before inserting when the cap is reached.

**Stale session purge (runbook — run periodically in production):**

```sql
UPDATE user_sessions SET is_active = FALSE
WHERE is_active = TRUE AND last_used_at < now() - interval '30 days';
```

---

## IP Detection

Priority order in `getRealIp()`:

1. **X-Real-IP** — validated with `VALID_IP` regex (rejects `"(null)"` and garbage). Set explicitly by trusted reverse proxy.
2. **X-Forwarded-For** — walked left-to-right; first entry that is a public IP is returned (skips private/proxy IPs).
3. **`req.ip`** — Express trust-proxy resolved value.
4. **`req.socket.remoteAddress`** — raw TCP connection, always the immediate upstream.

`VALID_IP = /^[\d.:a-fA-F]+$/` — rejects any non-IP string. `PRIVATE_IP` regex covers `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `::1`, `fd`, `fe80`, `::ffff:`.

Private IPs skip geo lookup and return `{ city: null, country: null }`.

**Apache config required:**

```apache
RequestHeader set X-Real-IP %{REMOTE_ADDR}s
```

Or for reliable cross-version support:

```apache
SetEnvIf Remote_Addr "(.*)" REAL_IP=$1
RequestHeader set X-Real-IP "%{REAL_IP}e"
```

**Deployment requirement: `X-Real-IP` is trusted unconditionally by `getRealIp()`, with no server-side check that the header actually came from a trusted proxy.** In this deployment (ARCHITECTURE.md §12, STACK.md "Infrastructure"), `web/nginx.conf` forwards the inbound `$http_x_real_ip` value as-is rather than setting it from `$remote_addr` — so the entire chain's correctness depends on the Traefik layer in front of `web` stripping or overwriting any client-supplied `X-Real-IP`/`X-Forwarded-For` before the request reaches nginx. Concretely, this requires:

1. Traefik's `forwardedHeaders.trustedIPs` must **not** be configured permissively (e.g. not `0.0.0.0/0`) — it must trust only the actual upstream (the load balancer / edge network in front of Traefik itself, or nothing, if Traefik is the true edge).
2. Nothing may be able to reach the `web` container's port 80 directly, bypassing Traefik — if a client could hit `web` (or `api`) directly, they could set `X-Real-IP` to any value and have it trusted outright, including for rate-limit bucketing, geo lookup, and `audit_logs.ip`.

If this deployment topology ever changes (a different reverse proxy, a CDN in front of Traefik, `api` becoming directly internet-reachable again), this section must be re-verified — `getRealIp()` itself has no way to detect a misconfigured upstream.

---

## Magic Link Auth

1. User submits email
2. If account exists with `email_verified=true` and a password: generate secure random token, hash it (SHA-256), store hash in `auth_tokens` with 15-minute expiry
3. Send plaintext token via email
4. On verify: consume token via `DELETE FROM auth_tokens WHERE token=$1 AND type=$2 AND expires_at>now() RETURNING user_id` — atomic single-use (row is physically removed; no double-consume possible)

Magic links are only valid for accounts that already have a password set.

---

## Invite Flow

1. Admin creates user → backend generates secure token, stores SHA-256 hash in `auth_tokens` as type `invite`
2. Email sent with plaintext token
3. User clicks link → frontend sends token + chosen password to `/api/auth/accept-invite`
4. Backend: hash token, find matching row, `activateAccount` (sets password_hash + email_verified=true), consume token

---

## Password Reset Flow

1. User submits email → token generated and stored (type `password_reset`, 1-hour expiry)
2. Cooldown check: `hasRecentResetToken` prevents spamming resets
3. On reset: token consumed atomically, `resetUserPassword` updates hash and increments token_version (invalidates all existing sessions)

**Token lifetime vs. cooldown:** Tokens are valid for **1 hour** once issued. A new reset request from the same user is rejected if a token was already created within the last **10 minutes** (`hasRecentResetToken`). These are independent: the cooldown prevents email flooding; the expiry limits the attack window.

---

## Rate Limiting

| Endpoint                | IP Limiter                  | Per-email Limiter         | Window          | Max   |
| ----------------------- | --------------------------- | ------------------------- | --------------- | ----- |
| POST /login             | loginLimiter (IP+email key) | — (DB-level, see Lockout) | 15 min          | 5     |
| POST /magic-link        | magicLinkLimiter            | emailLimiter              | 15 min / 1 hour | 5 / 5 |
| POST /forgot-password   | forgotPasswordLimiter       | emailLimiter              | 15 min / 1 hour | 5 / 5 |
| POST /accept-invite     | strictLimiter               | — (see note below)        | 15 min          | 5     |
| POST /magic-link/verify | strictLimiter               | —                         | 15 min          | 5     |
| POST /reset-password    | strictLimiter               | —                         | 15 min          | 5     |

`emailLimiter` keys by `email:` prefix on the normalised email. Applied as chained middleware alongside the existing IP limiter.

**`POST /accept-invite` is per-IP only, deliberately.** An earlier version chained a second limiter keyed `invite:${token.slice(0, 8)}`. That is not a real per-email limit — the request body carries only `token` + `password`, never an email address, so there is nothing to key on before the token is consumed. Keying on a token fragment instead gave an attacker a limiter key entirely of their own choosing (of no defensive value against brute force) while actively locking out a legitimate invitee who retries the same invite link more than 5 times in 15 minutes. Removed; `strictLimiter` (per-IP) is the real defense here, same as `/magic-link/verify` and `/reset-password` — also token-only requests with no email in the body.

---

## Authorization Model

> Rewritten for this app (UPGRADE.md F-2). The previous version of this section described a departmental booking app (`guests`/`bookings`/`excursions`, `staff_permissions`/`department_default_permissions`) that predates Koosani and never matched the code — this app has no department concept.

Implemented in `api/src/middleware/authorize.ts`, applied per-route alongside `requireAuth`.

### 1. Role hierarchy (`requireRole(minRole)`)

```
admin > manager > staff
```

A hard gate used only where no permission grant should ever loosen the requirement: `POST /gst/rates` (admin) and `POST /gst/periods/:id/unlock` (admin). Admins bypass every other check below.

### 2. Permission check (`requirePermission(resource, action)`)

`Permission = { resource, action }` (shared/src/primitives.ts):

- Resources: `customers`, `suppliers`, `items`, `inventory`, `invoices`, `bills`, `po`, `gst`, `reports`, `estimates` (Phase 25), `recurring` (Phase 26), `expenses` (Phase 31), `projects` (Phase 32 — covers projects, tasks, and time entries together)
- Actions: `view`, `add`, `edit`, `delete`, `export` (`export` applies only to `reports` — bulk CSV download)

Default policy, checked in this order (`hasPermission` in `authorize.ts`):

1. **admin** — always allowed.
2. **`view`** — always allowed for any authenticated role. There is no view-level restriction and no permission-restricted empty state implemented yet (DESIGN.md §7 describes the UI variant; it has no backing route check).
3. **`export`** (reports bulk CSV) — requires an **explicit grant** in `user_permissions`, even for managers. Also separately rate-limited at 10/hour/user (`rl:reports-bulk-export`), distinct from the general 20/min CSV limiter (§13.6, §13.7).
4. **manager** — allowed by default for `add`/`edit`/`delete` on every resource except the admin-only GST actions above ("elevated access").
5. **staff** — denied unless an explicit row exists in `user_permissions` for that exact `(userId, resource, action)`.

Grants are stored in `user_permissions` (`business_id`, `user_id`, `resource`, `action`, `granted_by`, unique on `(user_id, resource, action)`). There is no department-default table — grants are per-user only. Granting/revoking permissions is part of the `users` module (UPGRADE.md Phase 21); no UI exists yet.

**Dynamic per-request resource check (Phase 33c, custom fields).** `PUT /custom-fields/values` doesn't know which `PermissionResource` to gate on until it reads the request body's `docType` — `requirePermission(resource, action)` is fixed at route-registration time, so this route instead calls the exported `hasPermission(role, userId, resource, action)` function directly inside the handler, after mapping `docType` → resource via a lookup table. Same policy, same function, just invoked at request time instead of wired as middleware. Custom field _definitions_ (the admin-facing "what fields exist" config, not per-document values) are gated by `requireRole('admin')` instead, same as business settings — not a `PermissionResource` at all.

**Known gap:** report exports are documented as pure-read/no-audit (ARCHITECTURE.md §3, FUNCTIONS.md §reports), but §13.6 below calls for auditing bulk exports with filter parameters. This is unresolved — exports are currently permission-gated and rate-limited but **not** audit-logged. Track as a follow-up before relying on export audit trails.

---

## Frontend Auth State

Auth state lives entirely in the Pinia `auth` store — no `localStorage` persistence. On every page load, `bootstrap()` fires immediately and runs a single `GET /api/me` (which returns `{ ...profile, permissions }`). If the cookie is valid, user + permissions are populated; if not, the store stays empty (user = null). Either way, `initialized` is set to `true` and the spinner gate is released.

**No localStorage user cache.** Removing it eliminates stale-session UX bugs and ensures tab B sees the logged-out state immediately after tab A logs out (on next navigation, bootstrap re-runs and the empty 401 response clears the store).

**Error messages are generic.** Auth views (login, magic link, reset password, invite) map HTTP status codes to fixed strings — no backend error text is forwarded to the UI. 4xx on fire-and-forget endpoints (magic-link request, forgot-password) are treated as success to prevent email enumeration.

**Token extraction.** Deep-link tokens are extracted via `URLSearchParams(location.hash.slice(1)).get('token')` rather than positional `hash.slice(7)`. This is robust to hash parameter ordering and avoids silent empty-string tokens. `history.replaceState` is called after successful extraction (not unconditionally) so a missing-token redirect doesn't clear the URL prematurely.

---

## CSRF

No CSRF tokens are required. The combination of mitigations is sufficient:

1. **`sameSite=strict` cookie** — browser will not send the session cookie on cross-site requests, including form POSTs and navigations from other origins. This is the primary defense.
2. **Forgeable content types are rejected.** A cross-site HTML form's "simple request" can only carry `Content-Type: application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain` — never `application/json`, and never a missing header (forms always set one of the three). Global middleware in `api/src/server.ts` rejects exactly those three forgeable types on any non-GET/HEAD/OPTIONS request (UPGRADE.md F-5). A request with **no** `Content-Type` at all is allowed through — it isn't a CSRF vector (unreachable by a cross-site form) and blocking it broke legitimate bodyless same-origin calls (e.g. `POST /invoices/:id/issue` with no body) during Phase 20 verification. `multipart/form-data` is allowed for genuine file-upload routes, relying on mitigation #1 as the real defense there.
3. **All mutations are POST / PUT / DELETE** — no GET endpoint mutates state. This was audited across all route files.

**Magic-link and invite verify endpoints** (`POST /magic-link/verify`, `POST /accept-invite`) are POST endpoints initiated by the SPA after the user lands on the verify route. The `sameSite=strict` cookie is sent because the navigation originates from the same site; the SPA then makes a same-origin fetch with the token in the body.

---

## Security Headers

Applied via `helmet()`:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Referrer-Policy`
- `Permissions-Policy`

---

## CORS

```ts
cors({
  origin: (requestOrigin) =>
    requestOrigin === config.FRONTEND_URL || requestOrigin === config.PORTAL_FRONTEND_URL
      ? requestOrigin
      : undefined,
  credentials: true, // required for cookie transport
})
```

Two allowed origins, both explicit env-configured values — never a wildcard, never a regex. `PORTAL_FRONTEND_URL` was added in Phase 28 for the customer portal (§13.14); it's a distinct origin from `FRONTEND_URL`, not a fallback.

---

## Auth Event Logging

All auth events are recorded to `auth_logs`:

| Event              | Trigger                                           |
| ------------------ | ------------------------------------------------- |
| `login_success`    | Successful password login                         |
| `login_failed`     | Wrong password (with userId if account found)     |
| `logout`           | Single-device logout                              |
| `logout_all`       | All-device logout                                 |
| `logout_others`    | All other sessions revoked (current session kept) |
| `magic_link_used`  | Magic link verified                               |
| `password_changed` | Password updated via profile                      |
| `password_reset`   | Password reset via token                          |

Each log entry stores: `user_id`, `event`, `ip`, `user_agent`, `created_at`.

Admin activity log (`GET /api/admin/activity`) joins `auth_logs` with `users` and supports filtering by event type.

**Auth log purge (runbook — run periodically, default 1-year retention):**

```sql
DELETE FROM auth_logs WHERE created_at < now() - interval '1 year';
```

---

## Geo Lookup

Controlled by `GEO_PROVIDER` env var:

| Value                | Behaviour                                                                    |
| -------------------- | ---------------------------------------------------------------------------- |
| `disabled` (default) | Returns `{ city: null, country: null }` immediately — no external calls      |
| `ip-api`             | Calls `http://ip-api.com` (free tier, unencrypted — leaks IPs; dev/LAN only) |

**Preferred production path:** MaxMind GeoLite2 local DB via `maxmind` npm package — no external calls, no IP leakage. Set `GEO_PROVIDER=maxmind` when implemented.

Private IPs always return null regardless of provider.

---

## 13. Domain-specific additions for the accounting app

Everything above was inherited from a previous app and is sound. The following items address the threat profile specific to an accounting / GST / inventory application.

### 13.1 Emergency JWT secret rotation

The rotation procedure in the JWT section assumes the old secret has not leaked — it waits 8 hours for old-secret tokens to expire naturally. If the old secret _has_ leaked, that 8-hour window is unacceptable.

**Emergency procedure (use when a secret may be compromised):**

1. Deploy with new `JWT_SECRET`. Do **not** set `JWT_SECRET_PREVIOUS`.
2. Bump `token_version` for every user in one statement: `UPDATE users SET token_version = token_version + 1`.
3. Mark all `user_sessions.is_active = FALSE`.
4. All users are forced to re-login on next request. Old-secret tokens are now rejected on both the signature check (new secret) and the version check (bumped).

Audit-log this with action `emergency_jwt_rotation` and the responsible admin's user_id.

### 13.2 `token_version` lookup cache

The middleware checks `token_version` and `session.is_active` on every authenticated request. At low traffic the DB hit is negligible; at scale, cache results in-process for 30 seconds keyed by `(user_id, sid)`:

- Cache hit + valid → proceed.
- Cache hit + invalid → reject (and clear cache key).
- Cache miss → DB lookup, populate.

Invalidation is best-effort: `logout`, `logout-all`, password change, password reset, admin-initiated role change, user soft-delete, and emergency rotation all delete matching keys from the cache. Worst case is a 30-second stale acceptance after revocation — acceptable trade-off for the request-rate reduction. Implemented in `api/src/middleware/requireAuth.ts`; `getSessionWithTokenVersion` (repository) joins `users.token_version` fresh on every cache miss (UPGRADE.md F-1).

Following the established convention (routes, not services, call `invalidateSessionCache` — services don't import the middleware, to avoid a `users`/`auth` service → `middleware/requireAuth.ts` → `modules/auth/service.ts` import cycle for `auth`'s own routes), the following routes clear the cache after their service call bumps `token_version`: `POST /auth/logout`, `/logout-all`, `/logout-others`, `/change-password` (pre-existing), and now `POST /auth/reset-password` (`auth/service.ts`'s `resetPassword` returns `{ ok: true; userId }` so the route has an id to invalidate), `PATCH /users/:id` (only when the request body included `role`), and `DELETE /users/:id`.

### 13.3 Financial audit log (separate from auth log)

`auth_logs` records _who logged in_. `audit_logs` records _what they did_. Both exist; do not conflate them.

Table: `audit_logs`

| Column      | Type        | Purpose                                                                                                                                                                                            |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id          | uuid        | —                                                                                                                                                                                                  |
| business_id | uuid        | Multi-tenant scope                                                                                                                                                                                 |
| user_id     | uuid        | Actor                                                                                                                                                                                              |
| action      | text        | e.g., `invoice.issue`, `invoice.void`, `bill.confirm`, `po.approve`, `payment.record`, `stock.adjust`, `gst.period_lock`, `gst.period_unlock`, `user.permissions_change`, `emergency_jwt_rotation` |
| entity_type | text        | `invoice`, `bill`, `po`, `customer`, `item`, etc.                                                                                                                                                  |
| entity_id   | uuid        | —                                                                                                                                                                                                  |
| before_json | jsonb       | Row state before mutation (`NULL` for creates)                                                                                                                                                     |
| after_json  | jsonb       | Row state after mutation (`NULL` for deletes)                                                                                                                                                      |
| ip          | inet        | From `getRealIp()`                                                                                                                                                                                 |
| user_agent  | text        | —                                                                                                                                                                                                  |
| at          | timestamptz | —                                                                                                                                                                                                  |

**Append-only.** `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>;` Only the migration role can ever alter rows. Document in the migration that produces the table.

Every state-changing service method writes a row inside the same transaction as the mutation. If `audit.record` is not called, the service is wrong; lint can't catch this, so tests must — every service mutation test asserts a row was inserted.

### 13.4 Document immutability beyond invoices

The same principle applies to:

| Entity                | Immutable once…         | Correction mechanism                                      |
| --------------------- | ----------------------- | --------------------------------------------------------- |
| Sales invoice         | `status = 'issued'`     | Credit note                                               |
| Credit note           | `status = 'issued'`     | New invoice / debit note                                  |
| Supplier bill         | `status = 'confirmed'`  | Supplier credit note (record as debit memo)               |
| Payment received/made | always (once persisted) | Reversal entry; never UPDATE                              |
| Purchase order        | `status = 'approved'`   | Cancel + new PO                                           |
| GRN                   | always (once persisted) | Adjustment movement                                       |
| GST return snapshot   | always (once built)     | Build again as a new snapshot; previous remains for audit |

Enforce at both layers:

- Service-layer status guard.
- DB trigger on UPDATE rejecting changes to frozen columns when the row's status disallows it.

### 13.5 File upload surface

This app accepts uploads (supplier invoice PDFs, SOA files for extraction, possibly logos). New attack surface vs. the previous app.

**Rules (all implemented in `api/src/modules/files/service.ts` as of Phase 20, UPGRADE.md F-3):**

1. **MIME sniff, not extension.** Verify magic bytes server-side via the `file-type` package. Reject anything that doesn't match an allow-list: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. `file-type` cannot magic-byte-detect plain-text formats (CSV/legacy XLS); those are allowed through only if the first 8 KB contains no NUL byte (a strong disguised-binary signal).
2. **Size cap.** 25 MB per file by default; enforce at the proxy _and_ in the api.
3. **Virus scan.** Synchronous scan via `api/src/lib/virusScan.ts`, which speaks clamd's INSTREAM protocol directly over TCP to `CLAMAV_HOST:CLAMAV_PORT` (no client library). Reject on positive **or scanner unreachable** — except in `NODE_ENV=test`, where no clamd instance is provisioned and unreachability is treated as a pass (documented trade-off; a real clamd is required in every non-test environment, including local dev — see `docker-compose.yml`'s `clamav` service and STACK.md's open decision #2).
4. **Never serve from api origin.** Files live in object storage. Downloads are signed URLs (**5-minute** expiry, corrected from a 1-hour bug — UPGRADE.md F-8) generated after a permission check, and only for files with `scan_result = 'clean'`.
5. **Force download for user uploads.** `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on every signed-URL response. No inline rendering of supplier-supplied PDFs (defence against PDF JavaScript).
6. **Path is never user-controlled.** Object key is `{businessId}/uploads/{sha256}{ext}` — generated server-side, never accepted from the client.
7. **SHA-256 of uploaded bytes stored on the row.** Dedup + tamper evidence. Computed over the post-EXIF-strip buffer for images.
8. **Strip EXIF from images** before storage — re-encoded via `sharp` (which drops metadata by default), then hashed and stored.

### 13.6 PII and financial export controls

Bulk exports (full customer list CSV, GST return ZIPs, GL exports) carry concentrated PII and tax data.

- All bulk export endpoints require role `admin` or explicit `reports.export` permission — implemented (`assertExportAllowed` in `api/src/modules/reports/routes.ts`, UPGRADE.md F-2/F-7).
- Rate-limit bulk exports: 10 per hour per user — implemented (`rl:reports-bulk-export`, Redis-backed).
- **Not implemented:** audit-logging the export with filter parameters, and delivering CSVs via signed object-storage URLs instead of streaming directly from the api. Both remain open — `reports.*` service functions are documented as pure-read with no writes (ARCHITECTURE.md §3, FUNCTIONS.md §reports), which conflicts with adding an audit write here; resolve that conflict before implementing.

### 13.7 PDF / report generation rate limit

PDF generation (invoice PDF, SOA PDF, PO PDF, GST return bundle) is CPU-heavy. Without limits a logged-in user can drive the box to 100% CPU.

| Endpoint                            | Limiter      | Window | Max | Status      |
| ----------------------------------- | ------------ | ------ | --- | ----------- |
| `GET /invoices/:id/pdf`             | per-user     | 1 min  | 20  | ✅ Phase 18 |
| `GET /pos/:id/pdf`                  | per-user     | 1 min  | 20  | ✅ Phase 18 |
| `GET /customers/:id/soa?format=pdf` | per-user     | 1 min  | 10  | ✅ Phase 23 |
| `GET /suppliers/:id/soa?format=pdf` | per-user     | 1 min  | 10  | ✅ Phase 23 |
| `POST /invoices/:id/send`           | per-user     | 1 min  | 20  | ✅ Phase 24 |
| `POST /customers/:id/soa/send`      | per-user     | 1 min  | 10  | ✅ Phase 24 |
| `GET /estimates/:id/pdf`            | per-user     | 1 min  | 20  | ✅ Phase 25 |
| `POST /estimates/:id/send`          | per-user     | 1 min  | 20  | ✅ Phase 25 |
| `POST /gst/periods/:id/build`       | per-business | 5 min  | 3   | ✅ Phase 16 |
| `GET /reports/*?format=csv`         | per-user     | 1 min  | 20  | ✅ Phase 18 |
| `GET /reports/*?format=csv` (bulk)  | per-user     | 1 hour | 10  | ✅ Phase 20 |

**Implementation:** `api/src/lib/rateLimiter.ts` provides two limiters. `createRedisRateLimiter(keyPrefix, points, durationSec)` — Redis-backed via `rate-limiter-flexible`, correct across multiple API instances — backs every limiter in this table as of Phase 20 (UPGRADE.md F-7; previously all were in-process `Map`s that reset per instance/restart, multiplying every limit by the instance count). `createRateLimiter(windowMs, max)` (in-process) is deprecated and kept only for any call site not yet migrated.

PDF jobs go through the BullMQ `pdf` queue, rendered by `registerPdfWorker` (Phase 23) with concurrency limited at the worker level, so even if rate limits are bypassed (internal call) the queue absorbs the spike. Routes enqueue and synchronously await completion (`lib/pdfClient.ts`, 20s timeout) rather than polling — the CPU-heavy work still happens in the worker process, not the API's event loop.

### 13.8 CSP — explicit directives

Helmet defaults are too permissive for a SPA holding tax data. Pinned in Phase 18 via Hono `secureHeaders({ contentSecurityPolicy: { ... } })` in `api/src/server.ts`:

```
default-src 'self'
script-src 'self'                                    # no unsafe-inline, no unsafe-eval
style-src  'self' 'unsafe-inline'                    # PrimeVue injects inline styles for theming
img-src    'self' data: blob: <STORAGE_HOSTNAME>
font-src   'self' data:
connect-src 'self' <STORAGE_HOSTNAME>
frame-ancestors 'none'
form-action 'self'
base-uri 'self'
object-src 'none'
upgrade-insecure-requests
```

`<STORAGE_HOSTNAME>` is set via the `STORAGE_HOSTNAME` environment variable (see `api/src/lib/config.ts`). If not set, omitted from the CSP (acceptable in development; required in production). No wildcards.

`X-Frame-Options: DENY` is also set (via `xFrameOptions: 'DENY'` in secureHeaders) for compatibility with older browsers that do not honour `frame-ancestors`.

### 13.9 Email normalisation

`emailLimiter` keys on a normalised email. For B2B accounting, normalisation is:

```
email.trim().toLowerCase()
```

That's it. **No** Gmail dot-folding, no plus-tag stripping. Accounting users legitimately use `+vendor` tags and treating `a.b@gmail.com` ≠ `ab@gmail.com` is the correct behaviour for invitation flows.

### 13.10 Backups and tax-record retention

Maldives tax law requires retention of accounting records (default 5 years from end of tax year; verify current statute before relying on this).

**Required controls:**

1. **Daily DB backup**, encrypted at rest, retention ≥ 5 years for monthly snapshots, ≥ 30 days for daily snapshots. Point-in-time recovery for the last 7 days minimum.
2. **Issued-document archive**: every issued invoice PDF, credit note PDF, confirmed bill attachment, and built GST return bundle is mirrored to a separate object-storage bucket with **object lock / WORM** (write-once, read-many) configured for the retention period. Compromise of the primary bucket cannot destroy these records.
3. **Quarterly restore drill**: documented runbook, executed at least once per quarter, restoring to a scratch environment to confirm backups are usable. Log result.
4. **Soft-deleted master data** (customers, suppliers, items) is retained indefinitely. Hard delete is not exposed via any endpoint.

### 13.11 Multi-tenant isolation

`business_id` on every row is necessary but not sufficient. Additional controls:

1. **Every service call** receives `ctx.businessId` and includes it in the WHERE clause of every read and write. Cross-business reads must throw — no "best effort" filtering.
2. **Repository functions take `businessId` as a required parameter.** It is never sourced from request bodies or query strings.
3. **Integration tests** create two businesses and assert that user A cannot read or mutate business B's data via any endpoint, even with valid auth.
4. **Row-Level Security — NOT implemented (UPGRADE.md F-4).** This section previously claimed RLS on `invoices`/`bills`/`payments_received`/`payments_made`/`audit_logs` with `SET LOCAL app.current_business_id`; no migration ever added it, and the claim was corrected during the Phase 20 audit. Tenant isolation currently rests entirely on controls 1–3 above, which the audit confirmed are consistently applied. Adding real RLS would require every `db.transaction(...)` call site (dozens, across every service) to `SET LOCAL` the business id at the start of the transaction — a retrofit large enough to warrant its own dedicated pass rather than a partial/unverified implementation bundled into Phase 20.

### 13.12 Network exposure / deployment topology

Only the SPA and the API origin are internet-reachable. Everything else is private.

| Layer            | Internet-reachable      | Protection                             |
| ---------------- | ----------------------- | -------------------------------------- |
| Vue SPA (static) | Yes                     | No secrets in bundle                   |
| API origin       | Yes                     | TLS + CORS + auth + rate limit + audit |
| PostgreSQL       | **No**                  | Private network only                   |
| Redis (BullMQ)   | **No**                  | Private network only                   |
| Object storage   | **No** (bucket private) | Signed URLs from API only              |
| Worker process   | **No**                  | No HTTP server                         |

- The API process binds to `127.0.0.1` (or a private interface) and is **never** directly internet-reachable. A reverse proxy (Caddy / nginx / Cloudflare) is the only thing on `0.0.0.0:443`; it terminates TLS, sets `X-Real-IP`, and provides the WAF / DDoS layer.
- Database, Redis, and the worker have no public listener and live on a private network / VPC. DB and Redis ports are never exposed.
- `/healthz` and `/readyz` return status codes only; restrict to the load balancer's health-check source at the proxy.
- **The API's public origin does not need its own subdomain.** Since the Vue SPA is a static bundle executed in the end user's browser (not proxied through the web container), the browser calls the API directly — this needs _some_ publicly reachable, TLS-terminated origin, but it can be the same hostname as the web app under a path prefix (e.g. `https://<domain>/api/*`). CORS is origin-based, not path-based, so `FRONTEND_URL` stays the bare domain either way. In this deployment the prefix-stripping happens at the `web` service's nginx layer (`web/nginx.conf`'s `location /api/` reverse-proxies internally to the `api` service), not at the Traefik/reverse-proxy layer in front of the container — see STACK.md's "Exposing the api under the web app's own domain" for why a Traefik-only approach didn't hold up in practice.

### 13.13 Items NOT in this app

A short list of things people sometimes add that this app explicitly does not do, to avoid scope creep that breaks the threat model:

- No public API tokens (no third-party integrations in v1).
- No webhook outputs (no callbacks to user-supplied URLs — SSRF surface).
- No "import everything via Excel" endpoint without a review-and-confirm step (bulk import is a credential-stuffing-equivalent risk for data).
- No raw SQL endpoint, no "advanced query" feature.

If any of these are added later, this section is updated first, then the feature.

### 13.14 Customer portal (Phase 28, UPGRADE.md G-8)

The portal is genuinely new attack surface: it is reachable by people who are **not** staff, have no `users` row, and were never vetted by an admin. Everything below treats that as the starting assumption, not an afterthought.

**Separate origin.** The portal is its own deployable frontend (`portal/` workspace package, distinct from `web/`), served from its own origin in production (e.g. `portal.<domain>` vs `app.<domain>`). It talks to the same api process but never shares a build, a route prefix's implicit trust, or a cookie with the staff SPA.

**Separate identity model — no passwords, ever.**

- Portal users are **not** rows in `users`. They authenticate as a specific `(businessId, customerId)` pair via magic link only. There is no password to phish, brute-force, or reuse-attack.
- New tables: `portal_auth_tokens` (mirrors `auth_tokens` but keyed on `customerId`, not `userId` — a customer has no `users` row to reference) and `portal_sessions` (mirrors `user_sessions`, same shape, keyed on `customerId`).
- **Separate JWT secret** (`PORTAL_JWT_SECRET`, same `≥32 chars` boot validation as `JWT_SECRET`). A leaked staff secret cannot forge a portal session and vice versa — the two token spaces are cryptographically unrelated, not just logically separate. Portal JWT payload: `{ type: 'portal', businessId, customerId, sid }`. `type: 'portal'` is checked on every portal request in addition to signature/session validity, so a portal JWT can never be replayed against a staff route even if secrets were ever shared by mistake (they are not).
- **Session lifetime: 2 hours** (vs. staff's 8) — a portal session only needs to last long enough to review a document or two; shorter default lifetime reduces the exposure window from a stolen device/link.
- Magic-link request takes only an email address (no business context — the portal doesn't ask "which business," since a customer shouldn't need to know or care how Koosani's multi-tenancy works). The backend looks up **every** `customers` row across **every** business matching that email case-insensitively and not soft-deleted, and sends one magic-link email per match — each scoped to exactly one `(businessId, customerId)`. A customer who transacts with two Koosani-hosted businesses under the same email gets two separate emails and two separate sessions; there is no cross-business portal session.
- Same token mechanics as staff magic links: single-use, consumed via `DELETE ... RETURNING` (atomic, no double-consume), 15-minute expiry, SHA-256 hash stored (never the plaintext token).
- Same enumeration protection as existing auth flows: the request endpoint always returns 204 regardless of whether any customer matched.
- **Session cap: 10 active sessions per `(businessId, customerId)`**, same pattern as staff (`auth/repository.ts createSession`, §Session Management above) — `portalAuth/repository.ts createSession` evicts the session with the oldest `lastUsedAt` before inserting when the cap is reached.
- **Verify-before-session-creation ordering.** `portalAuth.verifyMagicLink` checks the customer still exists and is not soft-deleted (via `customers.assertExists`, the customers **service** — not its repository, per the cross-module rule in ARCHITECTURE.md §3) _before_ creating the portal session or the caller sets any cookie. A customer soft-deleted in the window between token issue and verify therefore never gets an orphaned active session; the route returns the same `401 invalid_token` as any other failed verify. `verifyMagicLink`'s success result carries the customer's `{ id, name, email }` directly, so the route no longer makes its own follow-up `assertExists` call after the fact.

**Rate limits** (Redis-backed, `createRedisRateLimiter`, same infra as staff auth):

| Endpoint                              | Limiter            | Window | Max |
| ------------------------------------- | ------------------ | ------ | --- |
| `POST /portal/auth/magic-link`        | per-IP + per-email | 15 min | 5   |
| `POST /portal/auth/magic-link/verify` | per-IP             | 15 min | 5   |
| `GET /portal/invoices/:id/pdf`        | per-portal-session | 1 min  | 20  |
| `GET /portal/estimates/:id/pdf`       | per-portal-session | 1 min  | 20  |
| `POST /portal/estimates/:id/accept`   | per-portal-session | 1 min  | 20  |
| `POST /portal/estimates/:id/decline`  | per-portal-session | 1 min  | 20  |

**Read-only by design, with exactly one mutation surface.** Every portal `GET` route is scoped to the authenticated `(businessId, customerId)` — the repository/service calls underneath are the _same_ customer-facing functions the staff SPA uses (`invoicing.getInvoice`, `estimates.getEstimate`, `customers.buildSoa`), called with the portal session's own IDs, never IDs from the request. There is exactly one write surface: `POST /portal/estimates/:id/accept` and `.../decline`, both of which re-check `estimate.customerId === session.customerId` before calling the existing `estimates.markAccepted`/`markDeclined` service functions (UPGRADE.md Phase 25 built these as staff-only; Phase 28 adds the actual customer-facing caller they were always meant to have).

**Drafts are never exposed to the portal.** `invoicing`/`estimates` list/get calls made from `portal/routes.ts` never surface `status: 'draft'` documents — a draft is internal working state, not something a customer has ever seen. `invoicing.listInvoices`/`estimates.listEstimates` (and their repository functions) accept an optional `excludeDraft` boolean (FUNCTIONS.md §invoicing/§estimates); the portal's list routes always pass `excludeDraft: true`. Every other status remains visible: an invoice can only reach `voided` by first being `issued`, and an estimate can only reach `declined`/`expired` by first being `sent` — both of those prior states were already customer-visible, so no new information is withheld by continuing to show the terminal state. Detail, PDF, accept, and decline routes each independently re-check `entity.status === 'draft'` and return the same `404 not_found` used for an ownership mismatch — never a distinguishable error — so a guessed ID belonging to a draft in the same business cannot be distinguished from one that doesn't exist at all.

**Audit trail for portal-initiated mutations.** `AuditCtx.userId` is widened to `string | null` (the `audit_logs.user_id` column was always nullable at the DB level — this is the first caller that actually needs that). Portal-initiated accept/decline calls `audit.record` with `userId: null`; the acting identity is recoverable from the audited entity's own `customerId` plus the portal session's IP/user-agent, which are still recorded. This is a deliberate, minimal schema change — not a new actor-identity column — because the estimate row already carries the customer relationship.

**PDF downloads.** Identical mechanism to staff PDF downloads (`files` module: signed URL, 5-minute expiry, `scan_result='clean'` required, `Content-Disposition: attachment`) — no portal-specific exception. The portal never proxies or streams a file itself.

**CORS.** `cors()`'s `origin` option becomes a function checking against **both** `FRONTEND_URL` (staff SPA) and `PORTAL_FRONTEND_URL` (portal SPA) — an explicit allow-list of exactly two origins, not a wildcard or regex.

**CSP.** Unchanged mechanism (`secureHeaders()` in the same api process serves both origins' API responses) — the portal frontend's own hosting is responsible for its own CSP on its own static assets, same as the staff SPA's hosting is today. If the portal is later served from the same api process as static files (not the current plan), this section must be revisited.

**What the portal explicitly does not get**, to keep the threat model narrow:

- No password login, no account settings, no profile editing.
- No visibility into any other customer's data, any supplier data, or any internal report.
- No ability to create, edit, or void an invoice — accept/decline on a `sent` estimate is the only state transition a portal session can trigger.
- No file upload surface (customers cannot push data into the system via the portal).
- No API tokens, no webhook callbacks — §13.13's rules apply to the portal exactly as they apply to the staff app.
