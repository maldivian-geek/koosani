import * as repo from './repository.js'
import type { DbTx } from '../../db/client.js'
import type { Permission } from '@koosani/shared'

export async function listForUser(userId: string, tx?: DbTx): Promise<Permission[]> {
  return repo.listForUser(userId, tx)
}

export async function replaceForUser(
  businessId: string,
  userId: string,
  permissions: Permission[],
  grantedBy: string,
  tx: DbTx,
): Promise<void> {
  await repo.replaceForUser(businessId, userId, permissions, grantedBy, tx)
}
