<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import AutoComplete from 'primevue/autocomplete'
import { Trash2, Plus, ArrowLeft } from 'lucide-vue-next'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { gstFor, sumGstLines, GST_RATES, money } from '@koosani/shared'
import type { InvoiceDraftCreate } from '@koosani/shared'

interface CustomerOption {
  id: string
  name: string
  tin: string | null
  currency?: string
}

interface ItemOption {
  id: string
  name: string
  sku: string
  unitPrice: string
  gstCategory: string
}

interface DraftLine {
  _key: number
  itemId: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: string
  sortOrder: number
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const invoiceId = computed(() => (route.params.id as string) || null)
const isEdit = computed(() => !!invoiceId.value)

// Form fields
const customer = ref<CustomerOption | null>(null)
const customerQuery = ref('')
const customerSuggestions = ref<CustomerOption[]>([])
const dueDate = ref<Date | null>(null)
const notes = ref('')
const currency = ref('MVR')
const saving = ref(false)
const loading = ref(false)

// Multi-currency (Phase 30, UPGRADE.md G-10) — fixed at draft creation,
// mirroring the backend (currency isn't part of InvoiceDraftPatch).
const currencyOptions = [
  { label: 'MVR', value: 'MVR' },
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'GBP', value: 'GBP' },
]

function onCustomerSelect(option: CustomerOption) {
  if (!isEdit.value) currency.value = option.currency ?? 'MVR'
  void loadBillableExpenses(option.id)
}

// ─── Billable expenses → invoice line (Phase 31, UPGRADE.md G-11) ────────────
// Create-only: once an invoice draft exists, expenses aren't re-fetched.
interface BillableExpense {
  id: string
  category: string
  description: string | null
  expenseDate: string
  amount: string
  gstCategory: string
}
const billableExpenses = ref<BillableExpense[]>([])
const addedExpenseIds = ref<Set<string>>(new Set())

async function loadBillableExpenses(customerId: string) {
  billableExpenses.value = []
  addedExpenseIds.value = new Set()
  if (isEdit.value) return
  try {
    const data = await apiFetch<{ items: BillableExpense[] }>(
      `/expenses/billable?customerId=${customerId}`,
    )
    billableExpenses.value = data.items
  } catch {
    billableExpenses.value = []
  }
}

function addExpenseAsLine(expense: BillableExpense) {
  lines.value.push({
    _key: lineKey++,
    itemId: null,
    description: expense.description
      ? `${expense.category}: ${expense.description}`
      : expense.category,
    qty: '1.0000',
    unitPrice: expense.amount,
    gstCategory: expense.gstCategory,
    sortOrder: lines.value.length,
  })
  addedExpenseIds.value.add(expense.id)
}

let lineKey = 0
const lines = ref<DraftLine[]>([
  {
    _key: lineKey++,
    itemId: null,
    description: '',
    qty: '1.0000',
    unitPrice: '0.00',
    gstCategory: 'general_8',
    sortOrder: 0,
  },
])

const gstCategoryOptions = [
  { label: 'General (8%)', value: 'general_8' },
  { label: 'Tourism (16%)', value: 'tourism_16' },
  { label: 'Tourism (17%)', value: 'tourism_17' },
  { label: 'Zero-rated', value: 'zero' },
  { label: 'Exempt', value: 'exempt' },
]

// ─── Live totals via @koosani/shared (never recomputed by hand) ───────────────

function lineSubtotal(line: DraftLine): string {
  try {
    return money.mul(line.qty || '0', line.unitPrice || '0')
  } catch {
    return '0.00'
  }
}

function lineGst(line: DraftLine): string {
  try {
    const taxable = lineSubtotal(line)
    const rate = GST_RATES[line.gstCategory] ?? '0.00'
    return gstFor(taxable, rate).gst
  } catch {
    return '0.00'
  }
}

function lineGross(line: DraftLine): string {
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

// ─── Customer autocomplete ────────────────────────────────────────────────────

async function searchCustomers(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true', pageSize: '20' })
    const data = await apiFetch<{ items: CustomerOption[] } | CustomerOption[]>(
      `/customers?${params}`,
    )
    customerSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    customerSuggestions.value = []
  }
}

// ─── Item autocomplete ────────────────────────────────────────────────────────

async function searchItems(query: string): Promise<ItemOption[]> {
  try {
    const params = new URLSearchParams({ q: query, active: 'true' })
    const data = await apiFetch<ItemOption[]>(`/items?${params}`)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

// Per-line item search state
const itemSuggestions = ref<Record<number, ItemOption[]>>({})

async function onItemSearch(key: number, event: { query: string }) {
  itemSuggestions.value[key] = await searchItems(event.query)
}

function onItemSelect(line: DraftLine, item: ItemOption) {
  line.itemId = item.id
  line.description = item.name
  line.unitPrice = item.unitPrice
  line.gstCategory = item.gstCategory
}

// ─── Line management ──────────────────────────────────────────────────────────

function addLine() {
  lines.value.push({
    _key: lineKey++,
    itemId: null,
    description: '',
    qty: '1.0000',
    unitPrice: '0.00',
    gstCategory: 'general_8',
    sortOrder: lines.value.length,
  })
}

function removeLine(key: number) {
  lines.value = lines.value.filter((l) => l._key !== key)
}

// ─── Load existing draft for edit mode ───────────────────────────────────────

onMounted(async () => {
  if (!isEdit.value) return
  loading.value = true
  try {
    const inv = await apiFetch<{
      id: string
      customerId: string
      customerName: string
      dueDate: string | null
      notes: string | null
      status: string
      currency: string
      lines: Array<{
        id: string
        itemId: string | null
        description: string
        qty: string
        unitPrice: string
        gstCategory: string
        sortOrder: number
      }>
    }>(`/invoices/${invoiceId.value}`)

    if (inv.status !== 'draft') {
      toast.add({
        severity: 'warn',
        summary: 'Cannot edit',
        detail: 'Only draft invoices can be edited.',
        life: 4000,
      })
      void router.replace(`/invoices/${invoiceId.value}`)
      return
    }

    customer.value = { id: inv.customerId, name: inv.customerName, tin: null }
    customerQuery.value = inv.customerName
    dueDate.value = inv.dueDate ? new Date(inv.dueDate) : null
    notes.value = inv.notes ?? ''
    currency.value = inv.currency
    lines.value = inv.lines.map((l) => ({
      _key: lineKey++,
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      gstCategory: l.gstCategory,
      sortOrder: l.sortOrder,
    }))
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'Invoice not found.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
    void router.replace('/invoices')
  } finally {
    loading.value = false
  }
})

// ─── Save ─────────────────────────────────────────────────────────────────────

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  errors.value = {}
  if (!customer.value) errors.value.customer = 'Customer is required.'
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

  const dueDateStr = dueDate.value
    ? `${dueDate.value.getFullYear()}-${String(dueDate.value.getMonth() + 1).padStart(2, '0')}-${String(dueDate.value.getDate()).padStart(2, '0')}`
    : undefined

  const body: InvoiceDraftCreate = {
    customerId: customer.value!.id,
    dueDate: dueDateStr,
    notes: notes.value || undefined,
    currency: currency.value as InvoiceDraftCreate['currency'],
    lines: lines.value.map((l, i) => ({
      itemId: l.itemId ?? undefined,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      gstCategory: l.gstCategory as InvoiceDraftCreate['lines'][number]['gstCategory'],
      sortOrder: i,
    })),
  }

  try {
    if (isEdit.value) {
      await apiFetch(`/invoices/${invoiceId.value}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Draft updated.', life: 3000 })
      void router.push(`/invoices/${invoiceId.value}`)
    } else {
      const inv = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (addedExpenseIds.value.size > 0) {
        await apiFetch('/expenses/mark-invoiced', {
          method: 'POST',
          body: JSON.stringify({ expenseIds: [...addedExpenseIds.value], invoiceId: inv.id }),
        }).catch(() => {
          // Non-fatal — the invoice itself was created successfully; the
          // expenses just won't show as "invoiced" and could be re-added.
          toast.add({
            severity: 'warn',
            summary: 'Note',
            detail: "The invoice was created, but couldn't mark the linked expenses as invoiced.",
            life: 6000,
          })
        })
      }
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Draft invoice created.',
        life: 3000,
      })
      void router.push(`/invoices/${inv.id}`)
    }
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
    <!-- Header -->
    <div class="flex items-center gap-4">
      <Button severity="secondary" text @click="() => void router.back()">
        <ArrowLeft class="w-4 h-4" />
        Back
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ isEdit ? 'Edit Draft Invoice' : 'New Invoice' }}
        </h2>
      </div>
      <Button :loading="saving" @click="save">Save Draft</Button>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else>
      <!-- Invoice header fields -->
      <div class="card p-6 space-y-5">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Details</h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <!-- Customer -->
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Customer <span class="text-red-500">*</span></label
            >
            <AutoComplete
              v-model="customer"
              :suggestions="customerSuggestions"
              option-label="name"
              placeholder="Search customers…"
              :class="{ 'p-invalid': errors.customer }"
              @complete="searchCustomers"
              @option-select="(e) => onCustomerSelect(e.value as CustomerOption)"
            >
              <template #option="{ option }">
                <div class="flex flex-col">
                  <span class="text-sm">{{ option.name }}</span>
                  <span v-if="option.tin" class="text-xs text-surface-400"
                    >TIN: {{ option.tin }}</span
                  >
                </div>
              </template>
            </AutoComplete>
            <span v-if="errors.customer" class="text-xs text-red-500">{{ errors.customer }}</span>
          </div>

          <!-- Due date -->
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Due Date</label
            >
            <DatePicker
              v-model="dueDate"
              date-format="dd M yy"
              placeholder="Select date"
              show-icon
              show-button-bar
            />
          </div>

          <!-- Currency (Phase 30, UPGRADE.md G-10) — fixed at draft creation -->
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Currency</label
            >
            <Select
              v-model="currency"
              :options="currencyOptions"
              option-label="label"
              option-value="value"
              :disabled="isEdit"
            />
          </div>

          <!-- Notes -->
          <div class="flex flex-col gap-1.5 md:col-span-2">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
            <Textarea
              v-model="notes"
              rows="2"
              placeholder="Optional notes for this invoice"
              auto-resize
            />
          </div>
        </div>
      </div>

      <!-- Billable expenses (Phase 31, UPGRADE.md G-11) -->
      <div v-if="billableExpenses.length > 0" class="card p-6 space-y-3">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">
          Billable Expenses for this Customer
        </h3>
        <p class="text-xs text-surface-500 -mt-1">
          Add any of these as a line item on this invoice. Once added, an expense can't be added
          again.
        </p>
        <div class="space-y-2">
          <div
            v-for="expense in billableExpenses"
            :key="expense.id"
            class="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-surface-50 dark:bg-surface-800"
          >
            <div>
              <span class="font-medium">{{ expense.category }}</span>
              <span v-if="expense.description" class="text-surface-500">
                — {{ expense.description }}</span
              >
              <span class="text-surface-400 text-xs ml-2">{{ expense.expenseDate }}</span>
            </div>
            <div class="flex items-center gap-3">
              <MoneyCell :amount="expense.amount" />
              <Button
                :label="addedExpenseIds.has(expense.id) ? 'Added' : 'Add'"
                size="small"
                severity="secondary"
                :disabled="addedExpenseIds.has(expense.id)"
                @click="addExpenseAsLine(expense)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Line items -->
      <div class="card p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
          <Button severity="secondary" size="small" @click="addLine">
            <Plus class="w-4 h-4" />
            Add Line
          </Button>
        </div>

        <span v-if="errors.lines" class="text-xs text-red-500">{{ errors.lines }}</span>

        <!-- Column headers -->
        <div
          class="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide px-1"
        >
          <span>Description / Item</span>
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
          <!-- Description / item picker -->
          <div class="flex flex-col gap-1">
            <AutoComplete
              v-model="line.description"
              :suggestions="itemSuggestions[line._key] ?? []"
              option-label="name"
              placeholder="Item or description"
              :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_description`] }"
              @complete="(e) => onItemSearch(line._key, e)"
              @option-select="(e) => onItemSelect(line, e.value as ItemOption)"
            />
            <span
              v-if="errors[`line_${lines.indexOf(line)}_description`]"
              class="text-xs text-red-500"
              >Required.</span
            >
          </div>

          <!-- Qty -->
          <div class="flex flex-col gap-1">
            <InputText
              v-model="line.qty"
              placeholder="1.0000"
              inputmode="decimal"
              class="text-right tabular-nums"
              :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_qty`] }"
            />
          </div>

          <!-- Unit price -->
          <div class="flex flex-col gap-1">
            <MoneyInput
              :model-value="line.unitPrice"
              :invalid="!!errors[`line_${lines.indexOf(line)}_price`]"
              @update:model-value="(v) => (line.unitPrice = v)"
            />
          </div>

          <!-- GST category -->
          <div>
            <Select
              v-model="line.gstCategory"
              :options="gstCategoryOptions"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>

          <!-- Line total (live computed) -->
          <div class="flex flex-col gap-1 text-right">
            <span class="text-sm font-medium tabular-nums text-surface-900 dark:text-surface-50">
              <MoneyCell :amount="lineGross(line)" />
            </span>
            <span class="text-xs text-surface-400">
              GST: <MoneyCell :amount="lineGst(line)" />
            </span>
          </div>

          <!-- Remove -->
          <div>
            <Button
              severity="danger"
              text
              size="small"
              :disabled="lines.length === 1"
              @click="removeLine(line._key)"
            >
              <Trash2 class="w-4 h-4" />
            </Button>
          </div>
        </div>

        <!-- Totals -->
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
              <span class="text-surface-900 dark:text-surface-50">Total</span>
              <MoneyCell :amount="totals.totalGross" />
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-3">
        <Button severity="secondary" @click="() => void router.back()">Cancel</Button>
        <Button :loading="saving" @click="save">Save Draft</Button>
      </div>
    </template>
  </div>
</template>
