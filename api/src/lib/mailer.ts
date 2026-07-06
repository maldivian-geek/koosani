import { Resend } from 'resend'
import { config } from './config.js'

let _resend: Resend | null = null

function getClient(): Resend | null {
  if (!_resend && config.RESEND_API_KEY) {
    _resend = new Resend(config.RESEND_API_KEY)
  }
  return _resend
}

type Attachment = {
  filename: string
  content: Buffer
}

type SendOpts = {
  to: string
  subject: string
  html: string
  text: string
  attachments?: Attachment[]
}

export async function sendEmail(opts: SendOpts): Promise<void> {
  const client = getClient()
  if (!client) {
    // Dev fallback: log the email instead of sending
    console.log('[mailer:dev] Email not sent (no RESEND_API_KEY):', {
      to: opts.to,
      subject: opts.subject,
      attachments: opts.attachments?.map((a) => a.filename),
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

// Phase 24, UPGRADE.md G-3/G-4

export function invoiceEmail(opts: {
  to: string
  businessName: string
  invoiceNumber: string
  total: string
  dueDate: string | null
  pdf: Buffer
}): SendOpts {
  const dueLine = opts.dueDate ? ` Payment is due by ${opts.dueDate}.` : ''
  return {
    to: opts.to,
    subject: `Invoice ${opts.invoiceNumber} from ${opts.businessName}`,
    text: `Please find attached invoice ${opts.invoiceNumber} for MVR ${opts.total}.${dueLine}`,
    html: `<p>Please find attached invoice <strong>${opts.invoiceNumber}</strong> for MVR ${opts.total}.${dueLine}</p>`,
    attachments: [{ filename: `${opts.invoiceNumber}.pdf`, content: opts.pdf }],
  }
}

export function receiptEmail(opts: {
  to: string
  businessName: string
  invoiceNumber: string
  amount: string
  paidAt: string
}): SendOpts {
  return {
    to: opts.to,
    subject: `Payment received — ${opts.invoiceNumber}`,
    text: `Thank you for your payment of MVR ${opts.amount} on ${opts.paidAt} for invoice ${opts.invoiceNumber}.`,
    html: `<p>Thank you for your payment of MVR ${opts.amount} on ${opts.paidAt} for invoice <strong>${opts.invoiceNumber}</strong>.</p>`,
  }
}

export function reminderEmail(opts: {
  to: string
  businessName: string
  invoiceNumber: string
  total: string
  balanceDue: string
  dueDate: string
  offsetDays: number
}): SendOpts {
  const tone =
    opts.offsetDays < 0
      ? `is due soon, on ${opts.dueDate}`
      : opts.offsetDays === 0
        ? `is due today, ${opts.dueDate}`
        : `was due on ${opts.dueDate} and is now overdue`
  return {
    to: opts.to,
    subject: `Reminder: invoice ${opts.invoiceNumber} ${opts.offsetDays > 0 ? 'is overdue' : 'is due'}`,
    text: `Invoice ${opts.invoiceNumber} (MVR ${opts.total}, balance due MVR ${opts.balanceDue}) ${tone}. Please arrange payment at your earliest convenience.`,
    html: `<p>Invoice <strong>${opts.invoiceNumber}</strong> (MVR ${opts.total}, balance due MVR ${opts.balanceDue}) ${tone}. Please arrange payment at your earliest convenience.</p>`,
  }
}

export function statementEmail(opts: {
  to: string
  businessName: string
  partyName: string
  from: string
  to_: string
  closingBalance: string
  pdf: Buffer
}): SendOpts {
  return {
    to: opts.to,
    subject: `Statement of account — ${opts.businessName} (${opts.from} to ${opts.to_})`,
    text: `Please find attached your statement of account for ${opts.from} to ${opts.to_}. Closing balance: MVR ${opts.closingBalance}.`,
    html: `<p>Please find attached your statement of account for ${opts.from} to ${opts.to_}. Closing balance: MVR ${opts.closingBalance}.</p>`,
    attachments: [{ filename: `statement-${opts.from}-to-${opts.to_}.pdf`, content: opts.pdf }],
  }
}

// Phase 25, UPGRADE.md G-5

export function estimateEmail(opts: {
  to: string
  businessName: string
  estimateNumber: string
  total: string
  expiryDate: string | null
  pdf: Buffer
}): SendOpts {
  const expiryLine = opts.expiryDate ? ` This estimate is valid until ${opts.expiryDate}.` : ''
  return {
    to: opts.to,
    subject: `Estimate ${opts.estimateNumber} from ${opts.businessName}`,
    text: `Please find attached estimate ${opts.estimateNumber} for MVR ${opts.total}.${expiryLine}`,
    html: `<p>Please find attached estimate <strong>${opts.estimateNumber}</strong> for MVR ${opts.total}.${expiryLine}</p>`,
    attachments: [{ filename: `${opts.estimateNumber}.pdf`, content: opts.pdf }],
  }
}
