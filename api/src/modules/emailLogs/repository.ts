import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { emailLogs, invoiceRemindersSent } from '../../db/schema/index.js'
import type { EmailLog, NewEmailLog } from '../../db/schema/index.js'

export type { EmailLog, NewEmailLog }

export async function insertLog(data: NewEmailLog, tx?: DbTx): Promise<EmailLog> {
  const q = tx ?? db
  const [row] = await q.insert(emailLogs).values(data).returning()
  return row!
}

export async function listForEntity(
  businessId: string,
  entityType: string,
  entityId: string,
): Promise<EmailLog[]> {
  return db
    .select()
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.businessId, businessId),
        eq(emailLogs.entityType, entityType),
        eq(emailLogs.entityId, entityId),
      ),
    )
    .orderBy(desc(emailLogs.createdAt))
}

// Returns true if this was a NEW insert (i.e. this offset hasn't fired for
// this invoice before) — the unique index on (invoice_id, offset_days) makes
// this the idempotency guard for the reminders cron.
export async function markReminderSent(
  businessId: string,
  invoiceId: string,
  offsetDays: number,
  tx?: DbTx,
): Promise<boolean> {
  const q = tx ?? db
  const rows = await q
    .insert(invoiceRemindersSent)
    .values({ businessId, invoiceId, offsetDays })
    .onConflictDoNothing()
    .returning()
  return rows.length > 0
}
