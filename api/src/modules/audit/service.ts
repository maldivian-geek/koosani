import { auditLogs } from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type AuditCtx = {
  userId: string
  businessId: string
  ip: string
  ua: string | undefined
}

// Deliberately not AuditCtx: record() is the one place that needs to accept a
// null actor (customer-portal mutations, Phase 28 UPGRADE.md G-8 — SECURITY.md
// §13.14). AuditCtx.userId stays a required string everywhere else, since most
// callers also reuse ctx.userId for createdBy/updatedBy columns that are
// NOT NULL — widening AuditCtx itself would ripple through every one of those.
// A real AuditCtx (userId: string) is still assignable here; only portal call
// sites construct a userId: null ctx directly.
export type AuditRecordCtx = Omit<AuditCtx, 'userId'> & { userId: string | null }

// The only function that writes audit_logs. Always called inside the mutating tx
// (ARCHITECTURE.md §3, SECURITY.md §13.3).
export async function record(
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  ctx: AuditRecordCtx,
  tx: DbTx,
): Promise<void> {
  await tx.insert(auditLogs).values({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action,
    entityType,
    entityId,
    beforeJson: before,
    afterJson: after,
    ip: ctx.ip,
    userAgent: ctx.ua ?? null,
  })
}
