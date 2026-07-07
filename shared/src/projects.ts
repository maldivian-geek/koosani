import { z } from 'zod'
import { Money, GstCategory, IsoDate } from './primitives.js'

// Projects & time tracking (Phase 32, UPGRADE.md G-12) — see ARCHITECTURE.md §4.12.

export const ProjectStatus = z.enum(['active', 'completed', 'archived'])
export type ProjectStatus = z.infer<typeof ProjectStatus>

export const ProjectCreate = z.object({
  customerId: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  status: ProjectStatus.optional(),
  defaultBillableRate: Money.optional(),
  defaultGstCategory: GstCategory.optional(),
})
export type ProjectCreate = z.infer<typeof ProjectCreate>

export const ProjectPatch = ProjectCreate.partial()
export type ProjectPatch = z.infer<typeof ProjectPatch>

export const TaskStatus = z.enum(['open', 'done'])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskCreate = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  status: TaskStatus.optional(),
  billable: z.boolean().optional(),
  billableRate: Money.optional(),
})
export type TaskCreate = z.infer<typeof TaskCreate>

export const TaskPatch = TaskCreate.partial()
export type TaskPatch = z.infer<typeof TaskPatch>

export const TimeEntryCreate = z.object({
  taskId: z.string().uuid().optional(),
  entryDate: IsoDate,
  // Decimal hours, same 4dp shape as invoice line qty (e.g. '1.5000' for 1h30m)
  hours: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Hours must be a positive decimal')
    .refine((v) => parseFloat(v) > 0, 'Hours must be greater than zero'),
  description: z.string().max(2000).optional(),
  billable: z.boolean().optional(),
  billableRate: Money.optional(),
  gstCategory: GstCategory.optional(),
})
export type TimeEntryCreate = z.infer<typeof TimeEntryCreate>

export const TimeEntryPatch = TimeEntryCreate.partial()
export type TimeEntryPatch = z.infer<typeof TimeEntryPatch>

export const TimeEntryMarkInvoiced = z.object({
  timeEntryIds: z.array(z.string().uuid()).min(1),
  invoiceId: z.string().uuid(),
})
export type TimeEntryMarkInvoiced = z.infer<typeof TimeEntryMarkInvoiced>
