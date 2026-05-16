import { auditLogs } from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type AuditCtx = {
  userId: string
  businessId: string
  ip: string
  ua: string | undefined
}

// The only function that writes audit_logs. Always called inside the mutating tx
// (ARCHITECTURE.md §3, SECURITY.md §13.3).
export async function record(
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  ctx: AuditCtx,
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
