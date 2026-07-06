import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { auditLogs } from '../../db/schema/index.js'
import type { AuditLog } from '../../db/schema/index.js'

export type { AuditLog }

export type ListAuditParams = {
  entityType: string | undefined
  entityId: string | undefined
  userId: string | undefined
  from: Date | undefined
  to: Date | undefined
  page: number
  pageSize: number
}

export async function listAuditLogs(
  businessId: string,
  { entityType, entityId, userId, from, to, page, pageSize }: ListAuditParams,
): Promise<{ rows: AuditLog[]; total: number }> {
  const where = and(
    eq(auditLogs.businessId, businessId),
    entityType ? eq(auditLogs.entityType, entityType) : undefined,
    entityId ? eq(auditLogs.entityId, entityId) : undefined,
    userId ? eq(auditLogs.userId, userId) : undefined,
    from ? gte(auditLogs.at, from) : undefined,
    to ? lte(auditLogs.at, to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(auditLogs).where(where),
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.at))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}
