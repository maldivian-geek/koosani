import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from './helpers'
import { gstPeriodTypeEnum } from './enums'

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tin: text('tin'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  allowBackorders: boolean('allow_backorders').default(false).notNull(),
  gstPeriodType: gstPeriodTypeEnum('gst_period_type').default('monthly').notNull(),
  ...timestamps,
  // nullable: no user exists yet when the business row is first created
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
})

export type Business = typeof businesses.$inferSelect
export type NewBusiness = typeof businesses.$inferInsert
