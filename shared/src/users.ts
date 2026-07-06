import { z } from 'zod'
import { Email, Permission, Role } from './primitives.js'

export const UserCreate = z.object({
  email: Email,
  name: z.string().min(1).max(200),
  role: Role,
  permissions: z.array(Permission).optional(),
})
export type UserCreate = z.infer<typeof UserCreate>

export const UserPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  role: Role.optional(),
  permissions: z.array(Permission).optional(),
})
export type UserPatch = z.infer<typeof UserPatch>

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
})
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>
