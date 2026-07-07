<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import AutoComplete from 'primevue/autocomplete'
import { Trash2, Plus, ArrowLeft } from 'lucide-vue-next'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { gstFor, sumGstLines, GST_RATES, money } from '@koosani/shared'
import type { CreditNoteCreate } from '@koosani/shared'

interface InvoiceOption {
  id: string
  number: string | null
  customerId: string
  customerName: string
  status: string
}

interface InvoiceLine {
  id: string
  itemId: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
}

interface CreditLine {
  _key: number
  itemId: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
}

const router = useRouter()
const toast = useToast()

const invoice = ref<InvoiceOption | null>(null)
const invoiceSuggestions = ref<InvoiceOption[]>([])
const invoiceLoading = ref(false)
const reason = ref('')
const saving = ref(false)
const errors = ref<Record<string, string>>({})

let lineKey = 0
const lines = ref<CreditLine[]>([])

const gstCategoryOptions = [
  { label: 'General (8%)', value: 'general_8' },
  { label: 'Tourism (16%)', value: 'tourism_16' },
  { label: 'Tourism (17%)', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

async function searchInvoices(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, status: 'issued', pageSize: '20' })
    const data = await apiFetch<{ items: InvoiceOption[] } | InvoiceOption[]>(`/invoices?${params}`)
    invoiceSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    invoiceSuggestions.value = []
  }
}

async function onInvoiceSelect(option: InvoiceOption) {
  invoiceLoading.value = true
  lines.value = []
  try {
    const full = await apiFetch<{ lines: InvoiceLine[] }>(`/invoices/${option.id}`)
    lines.value = full.lines.map((l) => ({
      _key: lineKey++,
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      gstCategory: l.gstCategory,
    }))
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't load the invoice's lines.",
      life: 5000,
    })
  } finally {
    invoiceLoading.value = false
  }
}

function addLine() {
  lines.value.push({
    _key: lineKey++,
    itemId: null,
    description: '',
    qty: '1.0000',
    unitPrice: '0.00',
    gstCategory: 'general_8',
  })
}

function removeLine(key: number) {
  lines.value = lines.value.filter((l) => l._key !== key)
}

function lineSubtotal(line: CreditLine): string {
  try {
    return money.mul(line.qty || '0', line.unitPrice || '0')
  } catch {
    return '0.00'
  }
}

function lineGst(line: CreditLine): string {
  try {
    const taxable = lineSubtotal(line)
    const rate = GST_RATES[line.gstCategory] ?? '0.00'
    return gstFor(taxable, rate).gst
  } catch {
    return '0.00'
  }
}

function lineGross(line: CreditLine): string {
  try {
    const taxable = lineSubtotal(line)
    const rate = GST_RATES[line.gstCategory] ?? '0.00'
    return gstFor(taxable, rate).gross
  } catch {
    return '0.00'
  }
}

const totals = computed(() => {
  const lineData = lines.value.map((l) => {
    try {
      const taxable = lineSubtotal(l)
      const rate = GST_RATES[l.gstCategory] ?? '0.00'
      const { gst } = gstFor(taxable, rate)
      return { taxable, gst }
    } catch {
      return { taxable: '0.00', gst: '0.00' }
    }
  })
  return sumGstLines(lineData)
})

function validate(): boolean {
  errors.value = {}
  if (!invoice.value) errors.value.invoice = 'Select the invoice this credit note is against.'
  if (!reason.value.trim()) errors.value.reason = 'A reason is required.'
  if (lines.value.length === 0) errors.value.lines = 'At least one line is required.'
  lines.value.forEach((l, i) => {
    if (!l.description.trim()) errors.value[`line_${i}_description`] = 'Required.'
    if (!l.qty || isNaN(parseFloat(l.qty)) || parseFloat(l.qty) <= 0)
      errors.value[`line_${i}_qty`] = 'Enter a valid quantity.'
    if (!l.unitPrice || isNaN(parseFloat(l.unitPrice)) || parseFloat(l.unitPrice) < 0)
      errors.value[`line_${i}_price`] = 'Enter a valid price.'
  })
  return Object.keys(errors.value).length === 0
}

async function save() {
  if (!validate()) return
  saving.value = true

  const body: CreditNoteCreate = {
    invoiceId: invoice.value!.id,
    reason: reason.value,
    lines: lines.value.map((l, i) => ({
      itemId: l.itemId ?? undefined,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      gstCategory: l.gstCategory as CreditNoteCreate['lines'][number]['gstCategory'],
      sortOrder: i,
    })),
  }

  try {
    const cn = await apiFetch<{ id: string }>('/credit-notes', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    toast.add({
      severity: 'success',
      summary: 'Created',
      detail: 'Draft credit note created.',
      life: 3000,
    })
    void router.push(`/credit-notes/${cn.id}`)
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 422
        ? 'Please check your inputs and try again.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4">
      <Button severity="secondary" text @click="() => void router.back()">
        <ArrowLeft class="w-4 h-4" />
        Back
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          New Credit Note
        </h2>
      </div>
      <Button :loading="saving" @click="save">Save Draft</Button>
    </div>

    <div class="card p-6 space-y-5">
      <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Against Invoice</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
            >Invoice <span class="text-red-500">*</span></label
          >
          <AutoComplete
            v-model="invoice"
            :suggestions="invoiceSuggestions"
            option-label="number"
            placeholder="Search issued invoices…"
            :class="{ 'p-invalid': errors.invoice }"
            @complete="searchInvoices"
            @option-select="(e) => onInvoiceSelect(e.value as InvoiceOption)"
          >
            <template #option="{ option }">
              <div class="flex flex-col">
                <span class="text-sm font-mono">{{ option.number }}</span>
                <span class="text-xs text-surface-400">{{ option.customerName }}</span>
              </div>
            </template>
          </AutoComplete>
          <span v-if="errors.invoice" class="text-xs text-red-500">{{ errors.invoice }}</span>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
            >Reason <span class="text-red-500">*</span></label
          >
          <Textarea
            v-model="reason"
            rows="2"
            placeholder="e.g. returned goods, billing correction"
            :class="{ 'p-invalid': errors.reason }"
            auto-resize
          />
          <span v-if="errors.reason" class="text-xs text-red-500">{{ errors.reason }}</span>
        </div>
      </div>
    </div>

    <div v-if="invoiceLoading" class="card p-6 text-center text-surface-500">
      Loading invoice lines…
    </div>

    <div v-else-if="invoice" class="card p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">
          Lines to Credit
        </h3>
        <Button severity="secondary" size="small" @click="addLine">
          <Plus class="w-4 h-4" />
          Add Line
        </Button>
      </div>
      <p class="text-xs text-surface-500 -mt-2">
        Prefilled from the invoice — edit quantities/amounts for a partial credit, or remove lines
        you're not crediting.
      </p>

      <span v-if="errors.lines" class="text-xs text-red-500">{{ errors.lines }}</span>

      <div
        class="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide px-1"
      >
        <span>Description</span>
        <span>Qty</span>
        <span>Unit Price</span>
        <span>GST Category</span>
        <span class="text-right">Line Total</span>
        <span />
      </div>

      <div
        v-for="line in lines"
        :key="line._key"
        class="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 items-start border-b border-surface-100 dark:border-surface-800 pb-4 last:border-0 last:pb-0"
      >
        <div class="flex flex-col gap-1">
          <InputText
            v-model="line.description"
            placeholder="Description"
            :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_description`] }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <InputText
            v-model="line.qty"
            placeholder="1.0000"
            inputmode="decimal"
            class="text-right tabular-nums"
            :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_qty`] }"
          />
        </div>
        <div class="flex flex-col gap-1">
          <MoneyInput
            :model-value="line.unitPrice"
            :invalid="!!errors[`line_${lines.indexOf(line)}_price`]"
            @update:model-value="(v) => (line.unitPrice = v)"
          />
        </div>
        <div>
          <Select
            v-model="line.gstCategory"
            :options="gstCategoryOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1 text-right">
          <span class="text-sm font-medium tabular-nums text-surface-900 dark:text-surface-50">
            <MoneyCell :amount="lineGross(line)" />
          </span>
          <span class="text-xs text-surface-400"> GST: <MoneyCell :amount="lineGst(line)" /> </span>
        </div>
        <div>
          <Button severity="danger" text size="small" @click="removeLine(line._key)">
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <div class="w-64 space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-surface-600 dark:text-surface-400">Subtotal</span>
            <MoneyCell :amount="totals.totalTaxable" />
          </div>
          <div class="flex justify-between">
            <span class="text-surface-600 dark:text-surface-400">GST</span>
            <MoneyCell :amount="totals.totalGst" />
          </div>
          <div
            class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
          >
            <span class="text-surface-900 dark:text-surface-50">Total credited</span>
            <MoneyCell :amount="totals.totalGross" />
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-3">
      <Button severity="secondary" @click="() => void router.back()">Cancel</Button>
      <Button :loading="saving" @click="save">Save Draft</Button>
    </div>
  </div>
</template>
