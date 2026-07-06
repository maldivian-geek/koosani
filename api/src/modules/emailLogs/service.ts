import * as repo from './repository.js'
import type { EmailLog, NewEmailLog } from './repository.js'

export type { EmailLog }

export async function listForEntity(
  businessId: string,
  entityType: string,
  entityId: string,
): Promise<EmailLog[]> {
  return repo.listForEntity(businessId, entityType, entityId)
}

export async function insertLog(data: NewEmailLog): Promise<EmailLog> {
  return repo.insertLog(data)
}
