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
import type { EstimateDraftCreate } from '@koosani/shared'

interface CustomerOption {
  id: string
  name: string
  tin: string | null
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

const estimateId = computed(() => (route.params.id as string) || null)
const isEdit = computed(() => !!estimateId.value)

const customer = ref<CustomerOption | null>(null)
const customerQuery = ref('')
const customerSuggestions = ref<CustomerOption[]>([])
const expiryDate = ref<Date | null>(null)
const notes = ref('')
const saving = ref(false)
const loading = ref(false)

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

async function searchItems(query: string): Promise<ItemOption[]> {
  try {
    const params = new URLSearchParams({ q: query, active: 'true' })
    const data = await apiFetch<ItemOption[]>(`/items?${params}`)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

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

onMounted(async () => {
  if (!isEdit.value) return
  loading.value = true
  try {
    const est = await apiFetch<{
      id: string
      customerId: string
      customerName: string
      expiryDate: string | null
      notes: string | null
      status: string
      lines: Array<{
        id: string
        itemId: string | null
        description: string
        qty: string
        unitPrice: string
        gstCategory: string
        sortOrder: number
      }>
    }>(`/estimates/${estimateId.value}`)

    if (est.status !== 'draft') {
      toast.add({
        severity: 'warn',
        summary: 'Cannot edit',
        detail: 'Only draft estimates can be edited.',
        life: 4000,
      })
      void router.replace(`/estimates/${estimateId.value}`)
      return
    }

    customer.value = { id: est.customerId, name: est.customerName, tin: null }
    customerQuery.value = est.customerName
    expiryDate.value = est.expiryDate ? new Date(est.expiryDate) : null
    notes.value = est.notes ?? ''
    lines.value = est.lines.map((l) => ({
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
        ? 'Estimate not found.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
    void router.replace('/estimates')
  } finally {
    loading.value = false
  }
})

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

  const expiryDateStr = expiryDate.value
    ? `${expiryDate.value.getFullYear()}-${String(expiryDate.value.getMonth() + 1).padStart(2, '0')}-${String(expiryDate.value.getDate()).padStart(2, '0')}`
    : undefined

  const body: EstimateDraftCreate = {
    customerId: customer.value!.id,
    expiryDate: expiryDateStr,
    notes: notes.value || undefined,
    lines: lines.value.map((l, i) => ({
      itemId: l.itemId ?? undefined,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      gstCategory: l.gstCategory as EstimateDraftCreate['lines'][number]['gstCategory'],
      sortOrder: i,
    })),
  }

  try {
    if (isEdit.value) {
      await apiFetch(`/estimates/${estimateId.value}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Draft updated.', life: 3000 })
      void router.push(`/estimates/${estimateId.value}`)
    } else {
      const est = await apiFetch<{ id: string }>('/estimates', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Draft estimate created.',
        life: 3000,
      })
      void router.push(`/estimates/${est.id}`)
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
    <div class="flex items-center gap-4">
      <Button severity="secondary" text @click="() => void router.back()">
        <ArrowLeft class="w-4 h-4" />
        Back
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ isEdit ? 'Edit Draft Estimate' : 'New Estimate' }}
        </h2>
      </div>
      <Button :loading="saving" @click="save">Save Draft</Button>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else>
      <div class="card p-6 space-y-5">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Details</h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
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

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Valid Until</label
            >
            <DatePicker
              v-model="expiryDate"
              date-format="dd M yy"
              placeholder="Defaults to business setting"
              show-icon
              show-button-bar
            />
          </div>

          <div class="flex flex-col gap-1.5 md:col-span-2">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
            <Textarea
              v-model="notes"
              rows="2"
              placeholder="Optional notes for this estimate"
              auto-resize
            />
          </div>
        </div>
      </div>

      <div class="card p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Line Items</h3>
          <Button severity="secondary" size="small" @click="addLine">
            <Plus class="w-4 h-4" />
            Add Line
          </Button>
        </div>

        <span v-if="errors.lines" class="text-xs text-red-500">{{ errors.lines }}</span>

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
            <span class="text-xs text-surface-400">
              GST: <MoneyCell :amount="lineGst(line)" />
            </span>
          </div>

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

        <div class="flex justify-end pt-2">
          <div class="w-64 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Subtotal</span>
              <MoneyCell :amount="totals.totalTaxable" />
            </div>
            <div class="flex justify-between">
              <span class="text-surface-600 dark:text-surface-400">Estimated GST</span>
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

      <div class="flex justify-end gap-3">
        <Button severity="secondary" @click="() => void router.back()">Cancel</Button>
        <Button :loading="saving" @click="save">Save Draft</Button>
      </div>
    </template>
  </div>
</template>
