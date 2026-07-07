import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as customers from '../customers/service.js'
import type { AuditCtx } from '../audit/service.js'
import type {
  Project,
  Task,
  TimeEntry,
  ListProjectParams,
  ListTimeEntryParams,
} from './repository.js'
import type {
  ProjectCreate,
  ProjectPatch,
  TaskCreate,
  TaskPatch,
  TimeEntryCreate,
  TimeEntryPatch,
} from '@koosani/shared'

export type { AuditCtx, Project, Task, TimeEntry, ListProjectParams, ListTimeEntryParams }

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function createProject(
  businessId: string,
  data: ProjectCreate,
  ctx: AuditCtx,
): Promise<Project> {
  if (data.customerId) await customers.assertExists(data.customerId, businessId)

  return db.transaction(async (tx) => {
    const project = await repo.insertProject(
      {
        businessId,
        customerId: data.customerId ?? null,
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? 'active',
        defaultBillableRate: data.defaultBillableRate ?? null,
        defaultGstCategory: data.defaultGstCategory ?? 'general_8',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record('project.create', 'project', project.id, null, { name: data.name }, ctx, tx)
    return project
  })
}

export async function getProject(businessId: string, id: string): Promise<Project> {
  const project = await repo.getById(businessId, id)
  if (!project) throw new NotFoundError(`Project ${id} not found`)
  return project
}

export async function listProjects(
  businessId: string,
  params: ListProjectParams,
): Promise<{ rows: Project[]; total: number }> {
  return repo.listProjects(businessId, params)
}

export async function updateProject(
  businessId: string,
  id: string,
  data: ProjectPatch,
  ctx: AuditCtx,
): Promise<Project> {
  return db.transaction(async (tx) => {
    const before = await repo.getById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Project ${id} not found`)
    if (data.customerId) await customers.assertExists(data.customerId, businessId)

    const updated = await repo.updateProject(
      businessId,
      id,
      {
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.defaultBillableRate !== undefined
          ? { defaultBillableRate: data.defaultBillableRate }
          : {}),
        ...(data.defaultGstCategory !== undefined
          ? { defaultGstCategory: data.defaultGstCategory }
          : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'project.update',
      'project',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )
    return updated
  })
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(
  businessId: string,
  projectId: string,
  data: TaskCreate,
  ctx: AuditCtx,
): Promise<Task> {
  return db.transaction(async (tx) => {
    const project = await repo.getById(businessId, projectId, tx)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)

    const task = await repo.insertTask(
      {
        businessId,
        projectId,
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? 'open',
        billable: data.billable ?? true,
        billableRate: data.billableRate ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'task.create',
      'task',
      task.id,
      null,
      { projectId, name: data.name },
      ctx,
      tx,
    )
    return task
  })
}

export async function listTasksByProject(businessId: string, projectId: string): Promise<Task[]> {
  return repo.listTasksByProject(businessId, projectId)
}

export async function updateTask(
  businessId: string,
  id: string,
  data: TaskPatch,
  ctx: AuditCtx,
): Promise<Task> {
  return db.transaction(async (tx) => {
    const before = await repo.getTaskById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Task ${id} not found`)

    const updated = await repo.updateTask(
      businessId,
      id,
      {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.billable !== undefined ? { billable: data.billable } : {}),
        ...(data.billableRate !== undefined ? { billableRate: data.billableRate } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'task.update',
      'task',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )
    return updated
  })
}

// ─── Time entries ─────────────────────────────────────────────────────────────
// Rate/GST/billable snapshot at creation time from the task (falling back to
// the project), never recomputed later — same principle as invoice line GST
// (ARCHITECTURE.md §4.1, extended to §4.12).

export async function createTimeEntry(
  businessId: string,
  projectId: string,
  data: TimeEntryCreate,
  ctx: AuditCtx,
): Promise<TimeEntry> {
  return db.transaction(async (tx) => {
    const project = await repo.getById(businessId, projectId, tx)
    if (!project) throw new NotFoundError(`Project ${projectId} not found`)

    let task: Task | null = null
    if (data.taskId) {
      task = await repo.getTaskById(businessId, data.taskId, tx)
      if (!task || task.projectId !== projectId) {
        throw new NotFoundError(`Task ${data.taskId} not found on this project`)
      }
    }

    const billable = data.billable ?? task?.billable ?? true
    const billableRate =
      data.billableRate ?? task?.billableRate ?? project.defaultBillableRate ?? null
    const gstCategory = data.gstCategory ?? project.defaultGstCategory

    if (billable && !billableRate) {
      throw new ValidationError(
        'A billable rate is required — set one on this entry, the task, or the project default',
      )
    }

    const entry = await repo.insertTimeEntry(
      {
        businessId,
        projectId,
        taskId: data.taskId ?? null,
        userId: ctx.userId,
        entryDate: data.entryDate,
        hours: data.hours,
        description: data.description ?? null,
        billable,
        billableRate,
        gstCategory,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'time_entry.create',
      'time_entry',
      entry.id,
      null,
      { projectId, hours: data.hours },
      ctx,
      tx,
    )
    return entry
  })
}

export async function listTimeEntries(
  businessId: string,
  params: ListTimeEntryParams,
): Promise<{ rows: TimeEntry[]; total: number }> {
  return repo.listTimeEntries(businessId, params)
}

export async function getTimeEntry(businessId: string, id: string): Promise<TimeEntry> {
  const entry = await repo.getTimeEntryById(businessId, id)
  if (!entry) throw new NotFoundError(`Time entry ${id} not found`)
  return entry
}

export async function updateTimeEntry(
  businessId: string,
  id: string,
  data: TimeEntryPatch,
  ctx: AuditCtx,
): Promise<TimeEntry> {
  return db.transaction(async (tx) => {
    const before = await repo.getTimeEntryById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Time entry ${id} not found`)
    if (before.invoicedAt) {
      throw new ValidationError(
        'This time entry has already been added to an invoice and can no longer be edited',
      )
    }

    const updated = await repo.updateTimeEntry(
      businessId,
      id,
      {
        ...(data.entryDate !== undefined ? { entryDate: data.entryDate } : {}),
        ...(data.hours !== undefined ? { hours: data.hours } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.billable !== undefined ? { billable: data.billable } : {}),
        ...(data.billableRate !== undefined ? { billableRate: data.billableRate } : {}),
        ...(data.gstCategory !== undefined ? { gstCategory: data.gstCategory } : {}),
        ...(data.taskId !== undefined ? { taskId: data.taskId } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'time_entry.update',
      'time_entry',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )
    return updated
  })
}

export async function deleteTimeEntry(
  businessId: string,
  id: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const entry = await repo.getTimeEntryById(businessId, id, tx)
    if (!entry) throw new NotFoundError(`Time entry ${id} not found`)
    if (entry.invoicedAt) {
      throw new ValidationError(
        'This time entry has already been added to an invoice and cannot be deleted',
      )
    }
    await repo.deleteTimeEntry(businessId, id, tx)
    await audit.record(
      'time_entry.delete',
      'time_entry',
      id,
      entry as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

export async function listUninvoicedBillable(
  businessId: string,
  customerId: string,
): Promise<TimeEntry[]> {
  return repo.listUninvoicedBillableForCustomer(businessId, customerId)
}

// Mirrors expenses.markInvoiced exactly (ARCHITECTURE.md §4.11's pattern) —
// locks the rows so two concurrent "add to invoice" attempts can't both
// consume the same time entry.
export async function markInvoiced(
  businessId: string,
  timeEntryIds: string[],
  invoiceId: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const rows = await repo.getManyForUpdate(businessId, timeEntryIds, tx)
    if (rows.length !== timeEntryIds.length) {
      throw new NotFoundError('One or more time entries were not found')
    }
    for (const row of rows) {
      if (row.invoicedAt) {
        throw new ValidationError(`Time entry ${row.id} has already been added to an invoice`)
      }
      if (!row.billable) {
        throw new ValidationError(`Time entry ${row.id} is not marked billable`)
      }
    }

    const invoicedAt = new Date()
    for (const row of rows) {
      await repo.updateTimeEntry(
        businessId,
        row.id,
        { invoiceId, invoicedAt, updatedBy: ctx.userId },
        tx,
      )
    }

    await audit.record(
      'time_entry.marked_invoiced',
      'invoice',
      invoiceId,
      null,
      { timeEntryIds },
      ctx,
      tx,
    )
  })
}
