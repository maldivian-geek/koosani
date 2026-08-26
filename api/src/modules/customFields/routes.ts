import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  CustomFieldDocType,
  CustomFieldDefinitionCreate,
  CustomFieldDefinitionPatch,
  CustomFieldValueUpsert,
} from '@koosani/shared'
import type { PermissionResource } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole, hasPermission } from '../../middleware/authorize.js'
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

// A custom field value on a document is an edit to that document, so it
// needs the same permission as editing the document itself — not a new,
// separate 'customFields' resource (ARCHITECTURE.md §4.15).
const DOC_TYPE_RESOURCE: Record<string, PermissionResource> = {
  invoice: 'invoices',
  credit_note: 'invoices',
  estimate: 'estimates',
  po: 'po',
  bill: 'bills',
}

export const customFieldRoutes = new Hono<AppEnv>()
customFieldRoutes.use('*', requireAuth)

// GET /custom-fields/definitions?docType=
customFieldRoutes.get(
  '/definitions',
  zValidator('query', z.object({ docType: CustomFieldDocType })),
  async (c) => {
    const { docType } = c.req.valid('query')
    const defs = await svc.listDefinitions(c.get('businessId'), docType)
    return c.json(defs)
  },
)

// POST /custom-fields/definitions — admin only, mirrors business settings
customFieldRoutes.post(
  '/definitions',
  requireRole('admin'),
  zValidator('json', CustomFieldDefinitionCreate),
  async (c) => {
    try {
      const def = await svc.createDefinition(c.get('businessId'), c.req.valid('json'), ctxFrom(c))
      return c.json(def, 201)
    } catch (err) {
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /custom-fields/definitions/:id
customFieldRoutes.patch(
  '/definitions/:id',
  requireRole('admin'),
  zValidator('json', CustomFieldDefinitionPatch),
  async (c) => {
    try {
      const def = await svc.updateDefinition(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(def)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// DELETE /custom-fields/definitions/:id
customFieldRoutes.delete('/definitions/:id', requireRole('admin'), async (c) => {
  try {
    await svc.deleteDefinition(c.get('businessId'), c.req.param('id'), ctxFrom(c))
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// GET /custom-fields/values?docType=&docId= — permission depends on the doc
// type being read, same dynamic per-request check as PUT /values below
// (Phase 37: view, not edit).
customFieldRoutes.get(
  '/values',
  zValidator('query', z.object({ docType: CustomFieldDocType, docId: z.string().uuid() })),
  async (c) => {
    const { docType, docId } = c.req.valid('query')
    const resource = DOC_TYPE_RESOURCE[docType]
    if (!resource || !(await hasPermission(c.get('role'), c.get('userId'), resource, 'view'))) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const values = await svc.listValuesForDoc(c.get('businessId'), docType, docId)
    return c.json(values)
  },
)

// PUT /custom-fields/values — permission depends on the doc type being edited
customFieldRoutes.put('/values', zValidator('json', CustomFieldValueUpsert), async (c) => {
  const data = c.req.valid('json')
  const resource = DOC_TYPE_RESOURCE[data.docType]
  if (!resource || !(await hasPermission(c.get('role'), c.get('userId'), resource, 'edit'))) {
    return c.json({ error: 'forbidden' }, 403)
  }
  try {
    const values = await svc.upsertValues(c.get('businessId'), data, ctxFrom(c))
    return c.json(values)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})
