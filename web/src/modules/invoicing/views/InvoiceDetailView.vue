<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Checkbox from 'primevue/checkbox'
import { useConfirm } from 'primevue/useconfirm'
import {
  ArrowLeft,
  Download,
  Mail,
  Pencil,
  FileX,
  CheckCircle,
  Plus,
  Trash2,
  Ban,
  Wallet,
  Truck,
} from 'lucide-vue-next'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface InvoiceLine {
  id: string
  itemId: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
  gstAmount: string
  lineTotal: string
  sortOrder: number
}

interface Payment {
  id: string
  amount: string
  method: string
  ref: string | null
  paidAt: string
  reversed: boolean
}

interface CreditNote {
  id: string
  number: string | null
  total: string
  issuedAt: string | null
  status: string
}

interface Invoice {
  id: string
  number: string | null
  customerId: string
  customerName: string
  status: string
  dueDate: string | null
  issuedAt: string | null
  notes: string | null
  subtotal: string
  gstAmount: string
  total: string
  paidAmount: string
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  currency: 'MVR' | 'USD' | 'EUR' | 'GBP'
  exchangeRate: string
  subtotalMvr: string
  gstAmountMvr: string
  totalMvr: string
  paidAmountMvr: string
  createdAt: string
  remindersEnabled: boolean
  lines: InvoiceLine[]
  payments: Payment[]
  creditNotes: CreditNote[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const invoiceId = computed(() => route.params.id as string)
const invoice = ref<Invoice | null>(null)
const loading = ref(false)

// ─── Issue ────────────────────────────────────────────────────────────────────
const issuing = ref(false)

async function issue() {
  confirm.require({
    message: 'Issue this invoice? It will be locked and a number will be allocated.',
    header: 'Issue Invoice',
    acceptLabel: 'Issue',
    rejectLabel: 'Cancel',
    accept: async () => {
      issuing.value = true
      try {
        await apiFetch(`/invoices/${invoiceId.value}/issue`, { method: 'POST', body: '{}' })
        toast.add({
          severity: 'success',
          summary: 'Issued',
          detail: 'Invoice has been issued.',
          life: 3000,
        })
        await load()
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 409
            ? 'This invoice cannot be issued (check GST period lock).'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
      } finally {
        issuing.value = false
      }
    },
  })
}

// ─── Void ─────────────────────────────────────────────────────────────────────
const voidDialogOpen = ref(false)
const voidReason = ref('')
const voiding = ref(false)
const voidError = ref('')

function resetVoidDialog() {
  voidReason.value = ''
  voidError.value = ''
}

async function submitVoid() {
  voidError.value = ''
  if (!voidReason.value.trim()) {
    voidError.value = 'Reason is required.'
    return
  }
  voiding.value = true
  try {
    await apiFetch(`/invoices/${invoiceId.value}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: voidReason.value }),
    })
    voidDialogOpen.value = false
    voidReason.value = ''
    toast.add({
      severity: 'info',
      summary: 'Voided',
      detail: 'Invoice has been voided and a reversing credit note was created.',
      life: 4000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 409
        ? 'Invoice cannot be voided in its current state.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    voiding.value = false
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────
const paymentDialogOpen = ref(false)
const paymentAmount = ref('0.00')
const paymentMethod = ref('cash')
const paymentRef = ref('')
const paymentDate = ref<Date>(new Date())
const paymentSaving = ref(false)
const paymentErrors = ref<Record<string, string>>({})

const paymentMethodOptions = [
  { label: 'Cash', value: 'cash' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'Card', value: 'card' },
  { label: 'Other', value: 'other' },
]

function openPaymentDialog() {
  paymentAmount.value = '0.00'
  paymentMethod.value = 'cash'
  paymentRef.value = ''
  paymentDate.value = new Date()
  paymentErrors.value = {}
  paymentDialogOpen.value = true
}

async function submitPayment() {
  paymentErrors.value = {}
  const amt = parseFloat(paymentAmount.value)
  if (isNaN(amt) || amt <= 0) {
    paymentErrors.value.amount = 'Enter a positive amount.'
    return
  }
  if (!paymentDate.value) {
    paymentErrors.value.paidAt = 'Date is required.'
    return
  }

  const d = paymentDate.value
  const paidAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  paymentSaving.value = true
  try {
    await apiFetch(`/invoices/${invoiceId.value}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: paymentAmount.value,
        method: paymentMethod.value,
        ref: paymentRef.value || undefined,
        paidAt,
      }),
    })
    paymentDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Payment recorded',
      detail: 'Payment has been recorded.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Please check the payment details.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    paymentSaving.value = false
  }
}

function reversePayment(pid: string) {
  confirm.require({
    message: 'Reverse this payment? This cannot be undone.',
    header: 'Reverse Payment',
    acceptLabel: 'Reverse',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await apiFetch(`/invoices/${invoiceId.value}/payments/${pid}`, { method: 'DELETE' })
        toast.add({
          severity: 'info',
          summary: 'Reversed',
          detail: 'Payment reversed.',
          life: 3000,
        })
        await load()
      } catch {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Something went wrong. Please try again.',
          life: 5000,
        })
      }
    },
  })
}

// ─── Write off ────────────────────────────────────────────────────────────────
const writeOffDialogOpen = ref(false)
const writeOffReason = ref('')
const writeOffError = ref('')
const writingOff = ref(false)

function openWriteOffDialog() {
  writeOffReason.value = ''
  writeOffError.value = ''
  writeOffDialogOpen.value = true
}

function resetWriteOffDialog() {
  writeOffReason.value = ''
  writeOffError.value = ''
}

async function submitWriteOff() {
  writeOffError.value = ''
  if (!writeOffReason.value.trim()) {
    writeOffError.value = 'Reason is required.'
    return
  }
  writingOff.value = true
  try {
    await apiFetch(`/invoices/${invoiceId.value}/write-off`, {
      method: 'POST',
      body: JSON.stringify({ reason: writeOffReason.value }),
    })
    writeOffDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Written off',
      detail: 'The outstanding balance has been written off.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Nothing outstanding to write off.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    writingOff.value = false
  }
}

// ─── Apply credit ─────────────────────────────────────────────────────────────
const applyCreditDialogOpen = ref(false)
const applyCreditAmount = ref('0.00')
const applyCreditError = ref('')
const applyingCredit = ref(false)

function openApplyCreditDialog() {
  applyCreditAmount.value = '0.00'
  applyCreditError.value = ''
  applyCreditDialogOpen.value = true
}

async function submitApplyCredit() {
  applyCreditError.value = ''
  const amt = parseFloat(applyCreditAmount.value)
  if (isNaN(amt) || amt <= 0) {
    applyCreditError.value = 'Enter a positive amount.'
    return
  }
  applyingCredit.value = true
  try {
    await apiFetch(`/invoices/${invoiceId.value}/apply-credit`, {
      method: 'POST',
      body: JSON.stringify({ amount: applyCreditAmount.value }),
    })
    applyCreditDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Applied',
      detail: 'Customer credit applied to this invoice.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Amount exceeds either the outstanding balance or the available credit.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    applyingCredit.value = false
  }
}

// ─── PDF download ─────────────────────────────────────────────────────────────
const downloading = ref(false)

async function downloadPdf() {
  downloading.value = true
  try {
    const result = await apiFetch<{ url?: string } | null>(`/invoices/${invoiceId.value}/pdf`)
    if (result && typeof result === 'object' && 'url' in result && result.url) {
      window.open(result.url, '_blank')
    } else {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to generate PDF. Please try again.',
        life: 4000,
      })
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to generate PDF. Please try again.',
      life: 4000,
    })
  } finally {
    downloading.value = false
  }
}

// ─── Delivery note (Phase 33, UPGRADE.md G-13/F-24) ──────────────────────────
const generatingDeliveryNote = ref(false)

async function generateDeliveryNote() {
  generatingDeliveryNote.value = true
  try {
    const dn = await apiFetch<{ id: string }>(`/invoices/${invoiceId.value}/delivery-note`, {
      method: 'POST',
      body: '{}',
    })
    toast.add({
      severity: 'success',
      summary: 'Generated',
      detail: 'Delivery note generated.',
      life: 3000,
    })
    void router.push(`/delivery-notes/${dn.id}`)
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't generate the delivery note. Please try again.",
      life: 5000,
    })
  } finally {
    generatingDeliveryNote.value = false
  }
}

// ─── Send email ───────────────────────────────────────────────────────────────
const sending = ref(false)

async function sendEmail() {
  sending.value = true
  try {
    await apiFetch(`/invoices/${invoiceId.value}/send`, { method: 'POST', body: '{}' })
    toast.add({
      severity: 'success',
      summary: 'Queued',
      detail: 'The invoice email has been queued for sending.',
      life: 3000,
    })
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to send email.', life: 4000 })
  } finally {
    sending.value = false
  }
}

// ─── Reminders toggle ─────────────────────────────────────────────────────────
const togglingReminders = ref(false)

async function toggleReminders() {
  if (!invoice.value) return
  togglingReminders.value = true
  const next = !invoice.value.remindersEnabled
  try {
    await apiFetch(`/invoices/${invoiceId.value}/reminders`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: next }),
    })
    invoice.value.remindersEnabled = next
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update reminder setting.',
      life: 4000,
    })
  } finally {
    togglingReminders.value = false
  }
}

// ─── Load ─────────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    invoice.value = await apiFetch<Invoice>(`/invoices/${invoiceId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/invoices')
      return
    }
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Something went wrong. Please try again.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

const activePayments = computed(() => invoice.value?.payments.filter((p) => !p.reversed) ?? [])
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/invoices')">
        <ArrowLeft class="w-4 h-4" />
        Invoices
      </Button>

      <div class="flex-1 min-w-0">
        <div v-if="invoice" class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50 truncate">
            {{ invoice.number ?? 'Draft Invoice' }}
          </h2>
          <StatusTag :status="invoice.status" />
        </div>
        <div
          v-else-if="loading"
          class="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse"
        />
      </div>

      <div v-if="invoice" class="flex items-center gap-2 flex-wrap">
        <!-- Edit (draft only) -->
        <Button
          v-if="invoice.status === 'draft'"
          severity="secondary"
          @click="() => void router.push(`/invoices/${invoiceId}/edit`)"
        >
          <Pencil class="w-4 h-4" />
          Edit
        </Button>

        <!-- Issue (draft only) -->
        <Button v-if="invoice.status === 'draft'" :loading="issuing" @click="issue">
          <CheckCircle class="w-4 h-4" />
          Issue
        </Button>

        <!-- Void (issued / partially_paid) -->
        <Button
          v-if="invoice.status === 'issued' || invoice.status === 'partially_paid'"
          severity="danger"
          outlined
          @click="voidDialogOpen = true"
        >
          <FileX class="w-4 h-4" />
          Void
        </Button>

        <!-- PDF download -->
        <Button severity="secondary" :loading="downloading" @click="downloadPdf">
          <Download class="w-4 h-4" />
          PDF
        </Button>

        <!-- Email (issued documents only) -->
        <Button
          v-if="invoice && invoice.status !== 'draft'"
          severity="secondary"
          outlined
          :loading="sending"
          @click="sendEmail"
        >
          <Mail class="w-4 h-4" />
          Email
        </Button>

        <!-- Delivery note (issued documents only, Phase 33, UPGRADE.md G-13/F-24) -->
        <Button
          v-if="invoice && invoice.status !== 'draft'"
          severity="secondary"
          outlined
          :loading="generatingDeliveryNote"
          @click="generateDeliveryNote"
        >
          <Truck class="w-4 h-4" />
          Delivery Note
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="invoice">
      <!-- Invoice summary -->
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Customer
            </p>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ invoice.customerName }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Issued
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="invoice.issuedAt" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Due Date
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="invoice.dueDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Balance Due
            </p>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-50 tabular-nums">
              <MoneyCell
                :amount="
                  String(
                    Math.max(0, parseFloat(invoice.total) - parseFloat(invoice.paidAmount)).toFixed(
                      2,
                    ),
                  )
                "
                :currency="invoice.currency"
              />
            </p>
            <p v-if="invoice.currency !== 'MVR'" class="text-xs text-surface-400 tabular-nums">
              <MoneyCell
                :amount="
                  String(
                    Math.max(
                      0,
                      parseFloat(invoice.totalMvr) - parseFloat(invoice.paidAmountMvr),
                    ).toFixed(2),
                  )
                "
                currency="MVR"
              />
            </p>
          </div>
        </div>
        <div
          v-if="invoice.notes"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800"
        >
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Notes
          </p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ invoice.notes }}
          </p>
        </div>
        <div
          v-if="invoice.status !== 'draft'"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800 flex items-center gap-2"
        >
          <Checkbox
            :model-value="invoice.remindersEnabled"
            binary
            input-id="reminders-enabled"
            :disabled="togglingReminders"
            @update:model-value="toggleReminders"
          />
          <label for="reminders-enabled" class="text-sm text-surface-700 dark:text-surface-300">
            Send automatic payment reminders for this invoice
          </label>
        </div>
      </div>

      <!-- Line items -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
        </div>
        <DataTable :value="invoice.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right tabular-nums" />
          <Column field="unitPrice" header="Unit Price" class="text-right">
            <template #body="{ data }">
              <MoneyCell :amount="(data as InvoiceLine).unitPrice" />
            </template>
          </Column>
          <Column field="gstCategory" header="GST" />
          <Column field="gstAmount" header="GST Amt" class="text-right">
            <template #body="{ data }">
              <MoneyCell :amount="(data as InvoiceLine).gstAmount" />
            </template>
          </Column>
          <Column field="lineTotal" header="Total" class="text-right">
            <template #body="{ data }">
              <MoneyCell :amount="(data as InvoiceLine).lineTotal" />
            </template>
          </Column>
        </DataTable>

        <!-- Totals row -->
        <div class="flex justify-end px-6 py-4 border-t border-surface-100 dark:border-surface-800">
          <div class="w-64 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Subtotal</span>
              <MoneyCell :amount="invoice.subtotal" :currency="invoice.currency" />
            </div>
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">GST</span>
              <MoneyCell :amount="invoice.gstAmount" :currency="invoice.currency" />
            </div>
            <div
              class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
            >
              <span class="text-surface-900 dark:text-surface-50">Total</span>
              <MoneyCell :amount="invoice.total" :currency="invoice.currency" />
            </div>
            <!-- MVR-equivalent, Phase 30 UPGRADE.md G-10 — only shown for
                 foreign-currency invoices; the exchangeRate is frozen at issue. -->
            <div
              v-if="invoice.currency !== 'MVR'"
              class="flex justify-between text-xs text-surface-400"
            >
              <span>Total (MVR @ {{ invoice.exchangeRate }})</span>
              <MoneyCell :amount="invoice.totalMvr" currency="MVR" />
            </div>
            <div
              v-if="parseFloat(invoice.paidAmount) > 0"
              class="flex justify-between text-green-600 dark:text-green-400"
            >
              <span>Paid</span>
              <MoneyCell :amount="invoice.paidAmount" :currency="invoice.currency" />
            </div>
          </div>
        </div>
      </div>

      <!-- Payments -->
      <div class="card p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Payments</h3>
          <div
            v-if="invoice.status === 'issued' || invoice.status === 'partially_paid'"
            class="flex gap-2"
          >
            <Button size="small" severity="secondary" outlined @click="openWriteOffDialog">
              <Ban class="w-4 h-4" />
              Write Off
            </Button>
            <Button size="small" severity="secondary" @click="openApplyCreditDialog">
              <Wallet class="w-4 h-4" />
              Apply Credit
            </Button>
            <Button size="small" @click="openPaymentDialog">
              <Plus class="w-4 h-4" />
              Record Payment
            </Button>
          </div>
        </div>

        <div v-if="activePayments.length === 0" class="text-center py-8 text-sm text-surface-400">
          No payments recorded yet.
        </div>

        <DataTable v-else :value="activePayments" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="paidAt" header="Date">
            <template #body="{ data }">
              <DateCell :date="(data as Payment).paidAt" />
            </template>
          </Column>
          <Column field="method" header="Method">
            <template #body="{ data }">
              <span class="capitalize">{{ (data as Payment).method.replace(/_/g, ' ') }}</span>
            </template>
          </Column>
          <Column field="ref" header="Ref">
            <template #body="{ data }">
              {{ (data as Payment).ref ?? '—' }}
            </template>
          </Column>
          <Column field="amount" header="Amount" class="text-right">
            <template #body="{ data }">
              <MoneyCell :amount="(data as Payment).amount" />
            </template>
          </Column>
          <Column header="" style="width: 48px">
            <template #body="{ data }">
              <Button
                v-if="invoice!.status !== 'paid'"
                severity="danger"
                text
                size="small"
                @click="reversePayment((data as Payment).id)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Credit notes (if any) -->
      <div v-if="invoice.creditNotes.length > 0" class="card p-6 space-y-4">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Credit Notes</h3>
        <DataTable :value="invoice.creditNotes" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="number" header="Number">
            <template #body="{ data }">
              <span class="font-mono">{{ (data as CreditNote).number ?? '—' }}</span>
            </template>
          </Column>
          <Column field="issuedAt" header="Issued">
            <template #body="{ data }">
              <DateCell :date="(data as CreditNote).issuedAt" />
            </template>
          </Column>
          <Column field="status" header="Status">
            <template #body="{ data }">
              <StatusTag :status="(data as CreditNote).status" />
            </template>
          </Column>
          <Column field="total" header="Amount" class="text-right">
            <template #body="{ data }">
              <MoneyCell :amount="(data as CreditNote).total" />
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>

  <!-- Void dialog -->
  <Dialog
    v-model:visible="voidDialogOpen"
    header="Void Invoice"
    modal
    :style="{ width: '30rem' }"
    @hide="resetVoidDialog"
  >
    <div class="space-y-4">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        Voiding will lock this invoice and create a reversing credit note. Any active payments will
        be reversed and returned to the customer as available credit. This cannot be undone.
      </p>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Reason <span class="text-red-500">*</span></label
        >
        <Textarea
          v-model="voidReason"
          rows="3"
          placeholder="Explain why this invoice is being voided…"
          :class="{ 'p-invalid': voidError }"
          auto-resize
        />
        <span v-if="voidError" class="text-xs text-red-500">{{ voidError }}</span>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="voidDialogOpen = false">Cancel</Button>
      <Button severity="danger" :loading="voiding" @click="submitVoid">Void Invoice</Button>
    </template>
  </Dialog>

  <!-- Payment dialog -->
  <Dialog
    v-model:visible="paymentDialogOpen"
    header="Record Payment"
    modal
    :style="{ width: '30rem' }"
  >
    <div class="space-y-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Amount <span class="text-red-500">*</span></label
        >
        <MoneyInput
          :model-value="paymentAmount"
          :invalid="!!paymentErrors.amount"
          @update:model-value="(v) => (paymentAmount = v)"
        />
        <span v-if="paymentErrors.amount" class="text-xs text-red-500">{{
          paymentErrors.amount
        }}</span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Method</label>
        <Select
          v-model="paymentMethod"
          :options="paymentMethodOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Reference</label>
        <InputText v-model="paymentRef" placeholder="Cheque no., transfer ref, etc." />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Date <span class="text-red-500">*</span></label
        >
        <DatePicker
          v-model="paymentDate"
          date-format="dd M yy"
          show-icon
          :class="{ 'p-invalid': paymentErrors.paidAt }"
        />
        <span v-if="paymentErrors.paidAt" class="text-xs text-red-500">{{
          paymentErrors.paidAt
        }}</span>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="paymentDialogOpen = false">Cancel</Button>
      <Button :loading="paymentSaving" @click="submitPayment">Record Payment</Button>
    </template>
  </Dialog>

  <!-- Write off dialog -->
  <Dialog
    v-model:visible="writeOffDialogOpen"
    header="Write Off Invoice"
    modal
    :style="{ width: '30rem' }"
    @hide="resetWriteOffDialog"
  >
    <div class="space-y-4">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        This closes out the remaining outstanding balance with no cash movement — for bad debt, not
        a real payment. It cannot be undone.
      </p>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Reason <span class="text-red-500">*</span></label
        >
        <Textarea
          v-model="writeOffReason"
          rows="3"
          placeholder="Explain why this balance is being written off…"
          :class="{ 'p-invalid': writeOffError }"
          auto-resize
        />
        <span v-if="writeOffError" class="text-xs text-red-500">{{ writeOffError }}</span>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="writeOffDialogOpen = false">Cancel</Button>
      <Button severity="danger" :loading="writingOff" @click="submitWriteOff">Write Off</Button>
    </template>
  </Dialog>

  <!-- Apply credit dialog -->
  <Dialog
    v-model:visible="applyCreditDialogOpen"
    header="Apply Customer Credit"
    modal
    :style="{ width: '26rem' }"
  >
    <div class="space-y-4">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        Applies the customer's available credit balance to reduce this invoice's outstanding amount.
      </p>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Amount</label>
        <MoneyInput v-model="applyCreditAmount" :invalid="!!applyCreditError" />
        <span v-if="applyCreditError" class="text-xs text-red-500">{{ applyCreditError }}</span>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="applyCreditDialogOpen = false">Cancel</Button>
      <Button :loading="applyingCredit" @click="submitApplyCredit">Apply Credit</Button>
    </template>
  </Dialog>
</template>
