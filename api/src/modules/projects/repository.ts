import { and, count, desc, eq, gte, isNull, isNotNull, lte, or } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { projects, tasks, timeEntries } from '../../db/schema/index.js'
import type {
  Project,
  NewProject,
  Task,
  NewTask,
  TimeEntry,
  NewTimeEntry,
} from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type { Project, Task, TimeEntry }

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getById(businessId: string, id: string, tx?: DbTx): Promise<Project | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(projects)
    .where(and(eq(projects.businessId, businessId), eq(projects.id, id)))
  return row ?? null
}

export type ListProjectParams = {
  customerId: string | undefined
  status: string | undefined
  page: number
  pageSize: number
}

export async function listProjects(
  businessId: string,
  params: ListProjectParams,
): Promise<{ rows: Project[]; total: number }> {
  const where = and(
    eq(projects.businessId, businessId),
    params.customerId ? eq(projects.customerId, params.customerId) : undefined,
    params.status ? eq(projects.status, params.status as Project['status']) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(projects).where(where),
    db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function insertProject(
  data: Omit<NewProject, 'id' | 'createdAt' | 'updatedAt'>,
  tx?: DbTx,
): Promise<Project> {
  const q = tx ?? db
  const [row] = await q.insert(projects).values(data).returning()
  if (!row) throw new Error('insertProject: no row returned')
  return row
}

export async function updateProject(
  businessId: string,
  id: string,
  data: Partial<Omit<NewProject, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx?: DbTx,
): Promise<Project> {
  const q = tx ?? db
  const [row] = await q
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(projects.businessId, businessId), eq(projects.id, id)))
    .returning()
  if (!row) throw new Error('updateProject: no row returned')
  return row
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function getTaskById(businessId: string, id: string, tx?: DbTx): Promise<Task | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(tasks)
    .where(and(eq(tasks.businessId, businessId), eq(tasks.id, id)))
  return row ?? null
}

export async function listTasksByProject(businessId: string, projectId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.businessId, businessId), eq(tasks.projectId, projectId)))
    .orderBy(desc(tasks.createdAt))
}

export async function insertTask(
  data: Omit<NewTask, 'id' | 'createdAt' | 'updatedAt'>,
  tx?: DbTx,
): Promise<Task> {
  const q = tx ?? db
  const [row] = await q.insert(tasks).values(data).returning()
  if (!row) throw new Error('insertTask: no row returned')
  return row
}

export async function updateTask(
  businessId: string,
  id: string,
  data: Partial<Omit<NewTask, 'id' | 'businessId' | 'projectId' | 'createdAt' | 'createdBy'>>,
  tx?: DbTx,
): Promise<Task> {
  const q = tx ?? db
  const [row] = await q
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(tasks.businessId, businessId), eq(tasks.id, id)))
    .returning()
  if (!row) throw new Error('updateTask: no row returned')
  return row
}

// ─── Time entries ─────────────────────────────────────────────────────────────

export async function getTimeEntryById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<TimeEntry | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.businessId, businessId), eq(timeEntries.id, id)))
  return row ?? null
}

export type ListTimeEntryParams = {
  projectId: string | undefined
  taskId: string | undefined
  userId: string | undefined
  billable: boolean | undefined
  invoiced: boolean | undefined
  from: string | undefined
  to: string | undefined
  page: number
  pageSize: number
}

export async function listTimeEntries(
  businessId: string,
  params: ListTimeEntryParams,
): Promise<{ rows: TimeEntry[]; total: number }> {
  const where = and(
    eq(timeEntries.businessId, businessId),
    params.projectId ? eq(timeEntries.projectId, params.projectId) : undefined,
    params.taskId ? eq(timeEntries.taskId, params.taskId) : undefined,
    params.userId ? eq(timeEntries.userId, params.userId) : undefined,
    params.billable !== undefined ? eq(timeEntries.billable, params.billable) : undefined,
    params.invoiced === true
      ? isNotNull(timeEntries.invoicedAt)
      : params.invoiced === false
        ? isNull(timeEntries.invoicedAt)
        : undefined,
    params.from ? gte(timeEntries.entryDate, params.from) : undefined,
    params.to ? lte(timeEntries.entryDate, params.to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(timeEntries).where(where),
    db
      .select()
      .from(timeEntries)
      .where(where)
      .orderBy(desc(timeEntries.entryDate), desc(timeEntries.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function insertTimeEntry(
  data: Omit<NewTimeEntry, 'id' | 'createdAt' | 'updatedAt'>,
  tx?: DbTx,
): Promise<TimeEntry> {
  const q = tx ?? db
  const [row] = await q.insert(timeEntries).values(data).returning()
  if (!row) throw new Error('insertTimeEntry: no row returned')
  return row
}

export async function updateTimeEntry(
  businessId: string,
  id: string,
  data: Partial<Omit<NewTimeEntry, 'id' | 'businessId' | 'projectId' | 'createdAt' | 'createdBy'>>,
  tx?: DbTx,
): Promise<TimeEntry> {
  const q = tx ?? db
  const [row] = await q
    .update(timeEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(timeEntries.businessId, businessId), eq(timeEntries.id, id)))
    .returning()
  if (!row) throw new Error('updateTimeEntry: no row returned')
  return row
}

export async function deleteTimeEntry(businessId: string, id: string, tx?: DbTx): Promise<void> {
  const q = tx ?? db
  await q
    .delete(timeEntries)
    .where(and(eq(timeEntries.businessId, businessId), eq(timeEntries.id, id)))
}

// Uninvoiced billable time entries for a customer's projects — mirrors
// expenses.listUninvoicedBillable (ARCHITECTURE.md §4.11's pattern, reused
// for §4.12).
export async function listUninvoicedBillableForCustomer(
  businessId: string,
  customerId: string,
): Promise<TimeEntry[]> {
  return db
    .select({
      id: timeEntries.id,
      businessId: timeEntries.businessId,
      projectId: timeEntries.projectId,
      taskId: timeEntries.taskId,
      userId: timeEntries.userId,
      entryDate: timeEntries.entryDate,
      hours: timeEntries.hours,
      description: timeEntries.description,
      billable: timeEntries.billable,
      billableRate: timeEntries.billableRate,
      gstCategory: timeEntries.gstCategory,
      invoiceId: timeEntries.invoiceId,
      invoicedAt: timeEntries.invoicedAt,
      createdAt: timeEntries.createdAt,
      updatedAt: timeEntries.updatedAt,
      createdBy: timeEntries.createdBy,
      updatedBy: timeEntries.updatedBy,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(
      and(
        eq(timeEntries.businessId, businessId),
        eq(projects.customerId, customerId),
        eq(timeEntries.billable, true),
        isNull(timeEntries.invoicedAt),
      ),
    )
    .orderBy(timeEntries.entryDate)
}

// Locks the rows until the caller's tx commits, so two concurrent "add to
// invoice" attempts can't both consume the same time entry.
export async function getManyForUpdate(
  businessId: string,
  ids: string[],
  tx: DbTx,
): Promise<TimeEntry[]> {
  if (ids.length === 0) return []
  return tx
    .select()
    .from(timeEntries)
    .where(
      and(eq(timeEntries.businessId, businessId), or(...ids.map((id) => eq(timeEntries.id, id)))),
    )
    .for('update')
}
