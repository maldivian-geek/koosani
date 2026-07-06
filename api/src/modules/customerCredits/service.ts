import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as customers from '../customers/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { CustomerCredit } from './repository.js'

export type { AuditCtx, CustomerCredit }

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export async function getBalance(businessId: string, customerId: string): Promise<string> {
  return repo.getBalance(businessId, customerId)
}

export async function listLedger(
  businessId: string,
  customerId: string,
): Promise<CustomerCredit[]> {
  return repo.listLedger(businessId, customerId)
}

// ─── Grants (called by invoicing, inside its own transaction) ────────────────

export async function creditFromOverpayment(
  businessId: string,
  customerId: string,
  amount: string,
  paymentId: string,
  ctx: AuditCtx,
  tx: DbTx,
): Promise<CustomerCredit> {
  const entry = await repo.insertEntry(
    {
      businessId,
      customerId,
      amount,
      kind: 'overpayment',
      referenceType: 'payment',
      referenceId: paymentId,
      createdBy: ctx.userId,
    },
    tx,
  )
  await audit.record(
    'customer_credit.overpayment_granted',
    'customer_credit',
    entry.id,
    null,
    { customerId, amount, paymentId },
    ctx,
    tx,
  )
  return entry
}

export async function creditFromVoidedInvoice(
  businessId: string,
  customerId: string,
  amount: string,
  invoiceId: string,
  ctx: AuditCtx,
  tx: DbTx,
): Promise<CustomerCredit> {
  const entry = await repo.insertEntry(
    {
      businessId,
      customerId,
      amount,
      kind: 'voided_invoice',
      referenceType: 'invoice',
      referenceId: invoiceId,
      createdBy: ctx.userId,
    },
    tx,
  )
  await audit.record(
    'customer_credit.voided_invoice_granted',
    'customer_credit',
    entry.id,
    null,
    { customerId, amount, invoiceId },
    ctx,
    tx,
  )
  return entry
}

// ─── Consumption (called by invoicing, inside its own transaction) ───────────
// Locks the customer's ledger first, so two concurrent applications can't
// both pass the balance check before either commits.

export async function applyToInvoice(
  businessId: string,
  customerId: string,
  invoiceId: string,
  amount: string,
  ctx: AuditCtx,
  tx: DbTx,
): Promise<CustomerCredit> {
  await repo.lockCustomerCredits(businessId, customerId, tx)

  const balance = await repo.getBalance(businessId, customerId, tx)
  if (new Decimal(balance).lt(amount)) {
    throw new ValidationError(`Insufficient credit balance (available: ${balance})`)
  }

  const entry = await repo.insertEntry(
    {
      businessId,
      customerId,
      amount: new Decimal(amount).negated().toFixed(2),
      kind: 'applied_to_invoice',
      referenceType: 'invoice',
      referenceId: invoiceId,
      createdBy: ctx.userId,
    },
    tx,
  )
  await audit.record(
    'customer_credit.applied_to_invoice',
    'customer_credit',
    entry.id,
    null,
    { customerId, amount, invoiceId },
    ctx,
    tx,
  )
  return entry
}

// ─── Manual entries (own routes, own transactions) ───────────────────────────

export async function recordAdvance(
  businessId: string,
  customerId: string,
  amount: string,
  notes: string | undefined,
  ctx: AuditCtx,
): Promise<CustomerCredit> {
  await customers.assertExists(customerId, businessId)
  if (new Decimal(amount).lte(0)) throw new ValidationError('Amount must be greater than zero')

  return db.transaction(async (tx) => {
    const entry = await repo.insertEntry(
      {
        businessId,
        customerId,
        amount,
        kind: 'advance',
        notes: notes ?? null,
        createdBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'customer_credit.advance_recorded',
      'customer_credit',
      entry.id,
      null,
      { customerId, amount, notes },
      ctx,
      tx,
    )
    return entry
  })
}

export async function refund(
  businessId: string,
  customerId: string,
  amount: string,
  notes: string | undefined,
  ctx: AuditCtx,
): Promise<CustomerCredit> {
  await customers.assertExists(customerId, businessId)
  if (new Decimal(amount).lte(0)) throw new ValidationError('Amount must be greater than zero')

  return db.transaction(async (tx) => {
    await repo.lockCustomerCredits(businessId, customerId, tx)
    const balance = await repo.getBalance(businessId, customerId, tx)
    if (new Decimal(balance).lt(amount)) {
      throw new ValidationError(`Insufficient credit balance (available: ${balance})`)
    }

    const entry = await repo.insertEntry(
      {
        businessId,
        customerId,
        amount: new Decimal(amount).negated().toFixed(2),
        kind: 'refunded',
        notes: notes ?? null,
        createdBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'customer_credit.refunded',
      'customer_credit',
      entry.id,
      null,
      { customerId, amount, notes },
      ctx,
      tx,
    )
    return entry
  })
}
