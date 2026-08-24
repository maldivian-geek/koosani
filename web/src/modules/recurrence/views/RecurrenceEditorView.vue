<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import DatePicker from 'primevue/datepicker'
import AutoComplete from 'primevue/autocomplete'
import { Trash2, Plus, ArrowLeft } from '@lucide/vue'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { gstFor, sumGstLines, GST_RATES, money, todayMv } from '@koosani/shared'
import type { RecurrenceProfileCreate } from '@koosani/shared'

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

const profileId = computed(() => (route.params.id as string) || null)
const isEdit = computed(() => !!profileId.value)

const customer = ref<CustomerOption | null>(null)
const customerQuery = ref('')
const customerSuggestions = ref<CustomerOption[]>([])
const name = ref('')
const frequency = ref<'weekly' | 'monthly' | 'quarterly' | 'yearly'>('monthly')
const startDate = ref<Date>(new Date(todayMv()))
const endDate = ref<Date | null>(null)
const autoIssue = ref(false)
const dueDaysAfterIssue = ref<number | null>(null)
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

const frequencyOptions = [
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
]

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

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(async () => {
  if (!isEdit.value) return
  loading.value = true
  try {
    const p = await apiFetch<{
      id: string
      customerId: string
      customerName: string
      name: string
      frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
      startDate: string
      endDate: string | null
      autoIssue: boolean
      dueDaysAfterIssue: number | null
      notes: string | null
      lines: Array<{
        id: string
        itemId: string | null
        description: string
        qty: string
        unitPrice: string
        gstCategory: string
        sortOrder: number
      }>
    }>(`/recurrence-profiles/${profileId.value}`)

    customer.value = { id: p.customerId, name: p.customerName, tin: null }
    customerQuery.value = p.customerName
    name.value = p.name
    frequency.value = p.frequency
    startDate.value = new Date(p.startDate)
    endDate.value = p.endDate ? new Date(p.endDate) : null
    autoIssue.value = p.autoIssue
    dueDaysAfterIssue.value = p.dueDaysAfterIssue
    notes.value = p.notes ?? ''
    lines.value = p.lines.map((l) => ({
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
        ? 'Profile not found.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
    void router.replace('/recurring')
  } finally {
    loading.value = false
  }
})

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  errors.value = {}
  if (!customer.value) errors.value.customer = 'Customer is required.'
  if (!name.value.trim()) errors.value.name = 'Name is required.'
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

  const lineBody = lines.value.map((l, i) => ({
    itemId: l.itemId ?? undefined,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    gstCategory: l.gstCategory as RecurrenceProfileCreate['lines'][number]['gstCategory'],
    sortOrder: i,
  }))

  try {
    if (isEdit.value) {
      await apiFetch(`/recurrence-profiles/${profileId.value}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.value,
          frequency: frequency.value,
          endDate: endDate.value ? toDateStr(endDate.value) : null,
          autoIssue: autoIssue.value,
          dueDaysAfterIssue: dueDaysAfterIssue.value,
          notes: notes.value || null,
          lines: lineBody,
        }),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Profile updated.', life: 3000 })
      void router.push(`/recurring/${profileId.value}`)
    } else {
      const body: RecurrenceProfileCreate = {
        customerId: customer.value!.id,
        name: name.value,
        frequency: frequency.value,
        startDate: toDateStr(startDate.value),
        endDate: endDate.value ? toDateStr(endDate.value) : undefined,
        autoIssue: autoIssue.value,
        dueDaysAfterIssue: dueDaysAfterIssue.value ?? undefined,
        notes: notes.value || undefined,
        lines: lineBody,
      }
      const p = await apiFetch<{ id: string }>('/recurrence-profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.add({ severity: 'success', summary: 'Created', detail: 'Profile created.', life: 3000 })
      void router.push(`/recurring/${p.id}`)
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
          {{ isEdit ? 'Edit Recurring Profile' : 'New Recurring Profile' }}
        </h2>
      </div>
      <Button :loading="saving" @click="save">Save</Button>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else>
      <div class="card p-6 space-y-5">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Details</h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Profile name <span class="text-red-500">*</span></label
            >
            <InputText
              v-model="name"
              placeholder="e.g. Monthly hosting retainer"
              :invalid="!!errors.name"
            />
            <span v-if="errors.name" class="text-xs text-red-500">{{ errors.name }}</span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Customer <span class="text-red-500">*</span></label
            >
            <AutoComplete
              v-model="customer"
              :suggestions="customerSuggestions"
              option-label="name"
              placeholder="Search customers…"
              :disabled="isEdit"
              :class="{ 'p-invalid': errors.customer }"
              @complete="searchCustomers"
            >
              <template #option="{ option }">
                <div class="flex flex-col">
                  <span class="text-sm">{{ option.name }}</span>
                </div>
              </template>
            </AutoComplete>
            <span v-if="errors.customer" class="text-xs text-red-500">{{ errors.customer }}</span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Frequency</label
            >
            <Select
              v-model="frequency"
              :options="frequencyOptions"
              option-label="label"
              option-value="value"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Due days after issue</label
            >
            <InputNumber
              v-model="dueDaysAfterIssue"
              :min="0"
              :max="365"
              placeholder="Uses business default if blank"
              show-buttons
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Start date <span class="text-red-500">*</span></label
            >
            <DatePicker v-model="startDate" date-format="dd M yy" show-icon :disabled="isEdit" />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >End date (optional)</label
            >
            <DatePicker
              v-model="endDate"
              date-format="dd M yy"
              placeholder="Runs indefinitely"
              show-icon
              show-button-bar
            />
          </div>

          <div class="flex items-center gap-2 md:col-span-2">
            <Checkbox v-model="autoIssue" binary input-id="auto-issue" />
            <label for="auto-issue" class="text-sm text-surface-700 dark:text-surface-300">
              Issue automatically (skips draft review — stock and numbering commit immediately)
            </label>
          </div>

          <div class="flex flex-col gap-1.5 md:col-span-2">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
            <Textarea
              v-model="notes"
              rows="2"
              placeholder="Copied onto each generated invoice"
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
              <span class="text-surface-600 dark:text-surface-400">Subtotal (per cycle)</span>
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

      <div class="flex justify-end gap-3">
        <Button severity="secondary" @click="() => void router.back()">Cancel</Button>
        <Button :loading="saving" @click="save">Save</Button>
      </div>
    </template>
  </div>
</template>
