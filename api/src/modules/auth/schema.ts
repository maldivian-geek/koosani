import { z } from 'zod'

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

const email = z.string().email().trim().toLowerCase()

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
})

export const magicLinkRequestSchema = z.object({
  email,
})

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1),
})

export const forgotPasswordSchema = z.object({
  email,
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password,
})

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password,
})

export const logoutSchema = z.object({})

export type LoginInput = z.infer<typeof loginSchema>
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>
export type MagicLinkVerifyInput = z.infer<typeof magicLinkVerifySchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
