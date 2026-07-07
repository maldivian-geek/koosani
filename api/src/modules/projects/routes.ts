import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  ProjectCreate,
  ProjectPatch,
  TaskCreate,
  TaskPatch,
  TimeEntryCreate,
  TimeEntryPatch,
  TimeEntryMarkInvoiced,
} from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

function ctxFrom(c: Context<AppEnv>) {
  return {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
}

const ListProjectsQuery = z.object({
  customerId: z.string().uuid().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

// ─── Projects (+ nested tasks/time-entries creation) ─────────────────────────

export const projectRoutes = new Hono<AppEnv>()
projectRoutes.use('*', requireAuth)

projectRoutes.get('/', zValidator('query', ListProjectsQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listProjects(c.get('businessId'), {
    customerId: q.customerId,
    status: q.status,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

projectRoutes.get('/:id', async (c) => {
  try {
    const project = await svc.getProject(c.get('businessId'), c.req.param('id'))
    const tasks = await svc.listTasksByProject(c.get('businessId'), project.id)
    return c.json({ ...project, tasks })
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

projectRoutes.post(
  '/',
  requirePermission('projects', 'add'),
  zValidator('json', ProjectCreate),
  async (c) => {
    const project = await svc.createProject(c.get('businessId'), c.req.valid('json'), ctxFrom(c))
    return c.json(project, 201)
  },
)

projectRoutes.patch(
  '/:id',
  requirePermission('projects', 'edit'),
  zValidator('json', ProjectPatch),
  async (c) => {
    try {
      const project = await svc.updateProject(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(project)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

projectRoutes.post(
  '/:id/tasks',
  requirePermission('projects', 'add'),
  zValidator('json', TaskCreate),
  async (c) => {
    try {
      const task = await svc.createTask(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(task, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

projectRoutes.post(
  '/:id/time-entries',
  requirePermission('projects', 'add'),
  zValidator('json', TimeEntryCreate),
  async (c) => {
    try {
      const entry = await svc.createTimeEntry(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(entry, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const taskRoutes = new Hono<AppEnv>()
taskRoutes.use('*', requireAuth)

taskRoutes.patch(
  '/:id',
  requirePermission('projects', 'edit'),
  zValidator('json', TaskPatch),
  async (c) => {
    try {
      const task = await svc.updateTask(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(task)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// ─── Time entries ─────────────────────────────────────────────────────────────

const ListTimeEntriesQuery = z.object({
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  billable: z.coerce.boolean().optional(),
  invoiced: z.coerce.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const timeEntryRoutes = new Hono<AppEnv>()
timeEntryRoutes.use('*', requireAuth)

timeEntryRoutes.get('/', zValidator('query', ListTimeEntriesQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listTimeEntries(c.get('businessId'), {
    projectId: q.projectId,
    taskId: q.taskId,
    userId: q.userId,
    billable: q.billable,
    invoiced: q.invoiced,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

timeEntryRoutes.get(
  '/billable',
  zValidator('query', z.object({ customerId: z.string().uuid() })),
  async (c) => {
    const { customerId } = c.req.valid('query')
    const items = await svc.listUninvoicedBillable(c.get('businessId'), customerId)
    return c.json({ items })
  },
)

timeEntryRoutes.get('/:id', async (c) => {
  try {
    const entry = await svc.getTimeEntry(c.get('businessId'), c.req.param('id'))
    return c.json(entry)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

timeEntryRoutes.patch(
  '/:id',
  requirePermission('projects', 'edit'),
  zValidator('json', TimeEntryPatch),
  async (c) => {
    try {
      const entry = await svc.updateTimeEntry(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(entry)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

timeEntryRoutes.delete('/:id', requirePermission('projects', 'delete'), async (c) => {
  try {
    await svc.deleteTimeEntry(c.get('businessId'), c.req.param('id'), ctxFrom(c))
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

timeEntryRoutes.post(
  '/mark-invoiced',
  requirePermission('projects', 'edit'),
  zValidator('json', TimeEntryMarkInvoiced),
  async (c) => {
    const { timeEntryIds, invoiceId } = c.req.valid('json')
    try {
      await svc.markInvoiced(c.get('businessId'), timeEntryIds, invoiceId, ctxFrom(c))
      return c.body(null, 204)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)
