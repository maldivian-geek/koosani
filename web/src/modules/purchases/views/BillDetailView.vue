<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import {
  ArrowLeft,
  Pencil,
  CheckCircle,
  Plus,
  Trash2,
  Paperclip,
  ExternalLink,
} from 'lucide-vue-next'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface BillLine {
  id: string
  itemId: string | null
  description: string
  qty: string
  unitCost: string
  gstCategory: string
  gstAmount: string
  lineTotal: string
  sortOrder: number
}

interface BillPayment {
  id: string
  amount: string
  method: string
  ref: string | null
  paidAt: string
  reversed: boolean
}

interface Bill {
  id: string
  number: string | null
  supplierId: string
  supplierName: string
  supplierRef: string | null
  status: string
  billDate: string | null
  dueDate: string | null
  notes: string | null
  subtotal: string
  gstAmount: string
  total: string
  paidAmount: string
  poId: string | null
  lines: BillLine[]
  payments: BillPayment[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const billId = computed(() => route.params.id as string)
const bill = ref<Bill | null>(null)
const loading = ref(false)
const confirming = ref(false)

// ─── Confirm ──────────────────────────────────────────────────────────────────

function confirmBill() {
  confirm.require({
    message:
      'Confirm this bill? It will be locked and a bill number allocated. GST rates will be snapshotted.',
    header: 'Confirm Bill',
    acceptLabel: 'Confirm',
    rejectLabel: 'Cancel',
    accept: async () => {
      confirming.value = true
      try {
        await apiFetch(`/bills/${billId.value}/confirm`, { method: 'POST', body: '{}' })
        toast.add({
          severity: 'success',
          summary: 'Confirmed',
          detail: 'Bill has been confirmed.',
          life: 3000,
        })
        await load()
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 409
            ? 'Bill cannot be confirmed (check GST period lock).'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
      } finally {
        confirming.value = false
      }
    },
  })
}

// ─── Payments ─────────────────────────────────────────────────────────────────

const paymentDialogOpen = ref(false)
const paymentAmount = ref('0.00')
const paymentMethod = ref('bank_transfer')
const paymentRef = ref('')
const paymentDate = ref<Date>(new Date())
const paymentSaving = ref(false)
const paymentErrors = ref<Record<string, string>>({})

const paymentMethodOptions = [
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cash', value: 'cash' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'Card', value: 'card' },
  { label: 'Other', value: 'other' },
]

function openPaymentDialog() {
  paymentAmount.value = '0.00'
  paymentMethod.value = 'bank_transfer'
  paymentRef.value = ''
  paymentDate.value = new Date()
  paymentErrors.value = {}
  paymentDialogOpen.value = true
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function submitPayment() {
  paymentErrors.value = {}
  const amt = parseFloat(paymentAmount.value)
  if (isNaN(amt) || amt <= 0) {
    paymentErrors.value.amount = 'Enter a positive amount.'
    return
  }

  paymentSaving.value = true
  try {
    await apiFetch(`/bills/${billId.value}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: paymentAmount.value,
        method: paymentMethod.value,
        ref: paymentRef.value || undefined,
        paidAt: toIso(paymentDate.value),
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
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Something went wrong. Please try again.',
      life: 5000,
    })
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
        await apiFetch(`/bills/${billId.value}/payments/${pid}`, { method: 'DELETE' })
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

// ─── File attach ──────────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null)
const attaching = ref(false)

async function attachFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  attaching.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    await apiFetch(`/bills/${billId.value}/attach`, { method: 'POST', body: form })
    toast.add({
      severity: 'success',
      summary: 'Attached',
      detail: 'File attached successfully.',
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'File upload failed. Max size is 25 MB.',
      life: 5000,
    })
  } finally {
    attaching.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    bill.value = await apiFetch<Bill>(`/bills/${billId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/bills')
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

const activePayments = computed(() => bill.value?.payments.filter((p) => !p.reversed) ?? [])
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/bills')">
        <ArrowLeft class="w-4 h-4" />Bills
      </Button>
      <div class="flex-1 min-w-0">
        <div v-if="bill" class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50 truncate">
            {{ bill.number ?? 'Draft Bill' }}
          </h2>
          <StatusTag :status="bill.status" />
          <span
            v-if="bill.poId"
            class="text-xs text-surface-400 cursor-pointer hover:text-surface-700"
            @click="() => void router.push(`/pos/${bill!.poId}`)"
          >
            <ExternalLink class="w-3 h-3 inline" /> From PO
          </span>
        </div>
        <div
          v-else-if="loading"
          class="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse"
        />
      </div>

      <div v-if="bill" class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="bill.status === 'draft'"
          severity="secondary"
          @click="() => void router.push(`/bills/${billId}/edit`)"
        >
          <Pencil class="w-4 h-4" />Edit
        </Button>
        <Button v-if="bill.status === 'draft'" :loading="confirming" @click="confirmBill">
          <CheckCircle class="w-4 h-4" />Confirm
        </Button>
        <!-- Attach supplier invoice scan -->
        <input
          ref="fileInput"
          type="file"
          accept=".pdf,.csv,.png,.jpg,.jpeg,.webp,.xlsx,.xls"
          class="hidden"
          @change="attachFile"
        />
        <Button severity="secondary" :loading="attaching" @click="() => fileInput?.click()">
          <Paperclip class="w-4 h-4" />Attach
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="bill">
      <!-- Summary -->
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Supplier
            </p>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ bill.supplierName }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Supplier Ref
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              {{ bill.supplierRef ?? '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Bill Date
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="bill.billDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Due Date
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="bill.dueDate" />
            </p>
          </div>
        </div>
        <div
          v-if="bill.notes"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800"
        >
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Notes
          </p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ bill.notes }}
          </p>
        </div>
      </div>

      <!-- Lines -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
        </div>
        <DataTable :value="bill.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right tabular-nums" />
          <Column field="unitCost" header="Unit Cost" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as BillLine).unitCost"
            /></template>
          </Column>
          <Column field="gstCategory" header="GST" />
          <Column field="gstAmount" header="GST Amt" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as BillLine).gstAmount"
            /></template>
          </Column>
          <Column field="lineTotal" header="Total" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as BillLine).lineTotal"
            /></template>
          </Column>
        </DataTable>
        <div class="flex justify-end px-6 py-4 border-t border-surface-100 dark:border-surface-800">
          <div class="w-64 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Subtotal</span
              ><MoneyCell :amount="bill.subtotal" />
            </div>
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">GST</span
              ><MoneyCell :amount="bill.gstAmount" />
            </div>
            <div
              class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
            >
              <span class="text-surface-900 dark:text-surface-50">Total</span
              ><MoneyCell :amount="bill.total" />
            </div>
            <div
              v-if="parseFloat(bill.paidAmount) > 0"
              class="flex justify-between text-green-600 dark:text-green-400"
            >
              <span>Paid</span><MoneyCell :amount="bill.paidAmount" />
            </div>
          </div>
        </div>
      </div>

      <!-- Payments -->
      <div class="card p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">
            Payments Made
          </h3>
          <Button
            v-if="bill.status === 'confirmed' || bill.status === 'partially_paid'"
            size="small"
            @click="openPaymentDialog"
          >
            <Plus class="w-4 h-4" />Record Payment
          </Button>
        </div>
        <div v-if="activePayments.length === 0" class="text-center py-8 text-sm text-surface-400">
          No payments recorded yet.
        </div>
        <DataTable v-else :value="activePayments" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="paidAt" header="Date">
            <template #body="{ data }"><DateCell :date="(data as BillPayment).paidAt" /></template>
          </Column>
          <Column field="method" header="Method">
            <template #body="{ data }"
              ><span class="capitalize">{{
                (data as BillPayment).method.replace(/_/g, ' ')
              }}</span></template
            >
          </Column>
          <Column field="ref" header="Ref">
            <template #body="{ data }">{{ (data as BillPayment).ref ?? '—' }}</template>
          </Column>
          <Column field="amount" header="Amount" class="text-right">
            <template #body="{ data }"
              ><MoneyCell :amount="(data as BillPayment).amount"
            /></template>
          </Column>
          <Column header="" style="width: 48px">
            <template #body="{ data }">
              <Button
                v-if="bill!.status !== 'paid'"
                severity="danger"
                text
                size="small"
                @click="reversePayment((data as BillPayment).id)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>

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
        <InputText v-model="paymentRef" placeholder="Transfer ref, cheque no., etc." />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Date <span class="text-red-500">*</span></label
        >
        <DatePicker v-model="paymentDate" date-format="dd M yy" show-icon />
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="paymentDialogOpen = false">Cancel</Button>
      <Button :loading="paymentSaving" @click="submitPayment">Record Payment</Button>
    </template>
  </Dialog>
</template>
