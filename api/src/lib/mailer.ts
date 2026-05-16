import { Resend } from 'resend'
import { config } from './config.js'

let _resend: Resend | null = null

function getClient(): Resend | null {
  if (!_resend && config.RESEND_API_KEY) {
    _resend = new Resend(config.RESEND_API_KEY)
  }
  return _resend
}

type SendOpts = {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail(opts: SendOpts): Promise<void> {
  const client = getClient()
  if (!client) {
    // Dev fallback: log the email instead of sending
    console.log('[mailer:dev] Email not sent (no RESEND_API_KEY):', {
      to: opts.to,
      subject: opts.subject,
    })
    return
  }
  await client.emails.send({ from: config.RESEND_FROM, ...opts })
}

export function magicLinkEmail(opts: { to: string; link: string }): SendOpts {
  return {
    to: opts.to,
    subject: 'Your sign-in link',
    text: `Click the link below to sign in. It expires in 15 minutes.\n\n${opts.link}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click the link below to sign in. It expires in 15 minutes.</p><p><a href="${opts.link}">${opts.link}</a></p><p>If you did not request this, ignore this email.</p>`,
  }
}

export function passwordResetEmail(opts: { to: string; link: string }): SendOpts {
  return {
    to: opts.to,
    subject: 'Reset your password',
    text: `Click the link below to reset your password. It expires in 1 hour.\n\n${opts.link}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${opts.link}">${opts.link}</a></p><p>If you did not request this, ignore this email.</p>`,
  }
}

export function inviteEmail(opts: { to: string; link: string; inviterName: string }): SendOpts {
  return {
    to: opts.to,
    subject: `${opts.inviterName} invited you`,
    text: `You have been invited. Click the link below to set your password and activate your account. The link expires in 7 days.\n\n${opts.link}`,
    html: `<p>You have been invited. Click the link below to set your password and activate your account. The link expires in 7 days.</p><p><a href="${opts.link}">${opts.link}</a></p>`,
  }
}
