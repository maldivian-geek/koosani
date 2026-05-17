<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import AutoComplete from 'primevue/autocomplete'
import { Trash2, Plus, ArrowLeft } from 'lucide-vue-next'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { money } from '@koosani/shared'
import type { PoDraftCreate } from '@koosani/shared'

interface SupplierOption {
  id: string
  name: string
  tin: string | null
}

interface ItemOption {
  id: string
  name: string
  sku: string
  unitPrice: string
}

interface DraftLine {
  _key: number
  itemId: string | null
  description: string
  qtyOrdered: string
  unitCost: string
  sortOrder: number
}

const router = useRouter()
const route = useRoute()
const toast = useToast()

const poId = computed(() => (route.params.id as string) || null)
const isEdit = computed(() => !!poId.value)

const supplier = ref<SupplierOption | null>(null)
const supplierSuggestions = ref<SupplierOption[]>([])
const orderDate = ref<Date | null>(null)
const expectedDate = ref<Date | null>(null)
const notes = ref('')
const saving = ref(false)
const loading = ref(false)

let lineKey = 0
const lines = ref<DraftLine[]>([
  {
    _key: lineKey++,
    itemId: null,
    description: '',
    qtyOrdered: '1.0000',
    unitCost: '0.00',
    sortOrder: 0,
  },
])

// ─── Subtotal (PO has no GST — ARCHITECTURE.md §4 / Phase 9) ─────────────────

function lineTotal(line: DraftLine): string {
  try {
    return money.mul(line.qtyOrdered || '0', line.unitCost || '0')
  } catch {
    return '0.00'
  }
}

const subtotal = computed(() => {
  try {
    return money.sum(lines.value.map((l) => lineTotal(l)))
  } catch {
    return '0.00'
  }
})

// ─── Supplier autocomplete ────────────────────────────────────────────────────

async function searchSuppliers(event: { query: string }) {
  try {
    const data = await apiFetch<SupplierOption[] | { items: SupplierOption[] }>(
      `/suppliers?q=${encodeURIComponent(event.query)}&active=true&pageSize=20`,
    )
    supplierSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    supplierSuggestions.value = []
  }
}

// ─── Item autocomplete ────────────────────────────────────────────────────────

const itemSuggestions = ref<Record<number, ItemOption[]>>({})

async function onItemSearch(key: number, event: { query: string }) {
  try {
    const data = await apiFetch<ItemOption[]>(
      `/items?q=${encodeURIComponent(event.query)}&active=true`,
    )
    itemSuggestions.value[key] = Array.isArray(data) ? data : []
  } catch {
    itemSuggestions.value[key] = []
  }
}

function onItemSelect(line: DraftLine, item: ItemOption) {
  line.itemId = item.id
  line.description = item.name
  line.unitCost = item.unitPrice
}

// ─── Line management ──────────────────────────────────────────────────────────

function addLine() {
  lines.value.push({
    _key: lineKey++,
    itemId: null,
    description: '',
    qtyOrdered: '1.0000',
    unitCost: '0.00',
    sortOrder: lines.value.length,
  })
}

function removeLine(key: number) {
  lines.value = lines.value.filter((l) => l._key !== key)
}

// ─── Load existing draft ──────────────────────────────────────────────────────

function toIso(d: Date | null): string | undefined {
  if (!d) return undefined
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(async () => {
  if (!isEdit.value) return
  loading.value = true
  try {
    const po = await apiFetch<{
      id: string
      supplierId: string
      supplierName: string
      orderDate: string | null
      expectedDate: string | null
      notes: string | null
      status: string
      lines: Array<{
        id: string
        itemId: string | null
        description: string
        qtyOrdered: string
        unitCost: string
        sortOrder: number
      }>
    }>(`/pos/${poId.value}`)

    if (po.status !== 'draft') {
      toast.add({
        severity: 'warn',
        summary: 'Cannot edit',
        detail: 'Only draft POs can be edited.',
        life: 4000,
      })
      void router.replace(`/pos/${poId.value}`)
      return
    }

    supplier.value = { id: po.supplierId, name: po.supplierName, tin: null }
    orderDate.value = po.orderDate ? new Date(po.orderDate) : null
    expectedDate.value = po.expectedDate ? new Date(po.expectedDate) : null
    notes.value = po.notes ?? ''
    lines.value = po.lines.map((l) => ({
      _key: lineKey++,
      itemId: l.itemId,
      description: l.description,
      qtyOrdered: l.qtyOrdered,
      unitCost: l.unitCost,
      sortOrder: l.sortOrder,
    }))
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'PO not found.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
    void router.replace('/pos')
  } finally {
    loading.value = false
  }
})

// ─── Save ─────────────────────────────────────────────────────────────────────

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  errors.value = {}
  if (!supplier.value) errors.value.supplier = 'Supplier is required.'
  if (lines.value.length === 0) errors.value.lines = 'At least one line is required.'
  lines.value.forEach((l, i) => {
    if (!l.description.trim()) errors.value[`line_${i}_desc`] = 'Required.'
    if (!l.qtyOrdered || isNaN(parseFloat(l.qtyOrdered)) || parseFloat(l.qtyOrdered) <= 0)
      errors.value[`line_${i}_qty`] = 'Enter a valid quantity.'
    if (!l.unitCost || isNaN(parseFloat(l.unitCost)) || parseFloat(l.unitCost) < 0)
      errors.value[`line_${i}_cost`] = 'Enter a valid cost.'
  })
  return Object.keys(errors.value).length === 0
}

async function save() {
  if (!validate()) return
  saving.value = true

  const body: PoDraftCreate = {
    supplierId: supplier.value!.id,
    orderDate: toIso(orderDate.value),
    expectedDate: toIso(expectedDate.value),
    notes: notes.value || undefined,
    lines: lines.value.map((l, i) => ({
      itemId: l.itemId ?? undefined,
      description: l.description,
      qtyOrdered: l.qtyOrdered,
      unitCost: l.unitCost,
      sortOrder: i,
    })),
  }

  try {
    if (isEdit.value) {
      await apiFetch(`/pos/${poId.value}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Draft PO updated.', life: 3000 })
      void router.push(`/pos/${poId.value}`)
    } else {
      const po = await apiFetch<{ id: string }>('/pos', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.add({
        severity: 'success',
        summary: 'Created',
        detail: 'Draft PO created.',
        life: 3000,
      })
      void router.push(`/pos/${po.id}`)
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
        <ArrowLeft class="w-4 h-4" />Back
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ isEdit ? 'Edit Draft PO' : 'New Purchase Order' }}
        </h2>
      </div>
      <Button :loading="saving" @click="save">Save Draft</Button>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else>
      <!-- Header fields -->
      <div class="card p-6 space-y-5">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Details</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Supplier <span class="text-red-500">*</span></label
            >
            <AutoComplete
              v-model="supplier"
              :suggestions="supplierSuggestions"
              option-label="name"
              placeholder="Search suppliers…"
              :class="{ 'p-invalid': errors.supplier }"
              @complete="searchSuppliers"
            />
            <span v-if="errors.supplier" class="text-xs text-red-500">{{ errors.supplier }}</span>
          </div>

          <div />

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Order Date</label
            >
            <DatePicker
              v-model="orderDate"
              date-format="dd M yy"
              placeholder="Date of order"
              show-icon
              show-button-bar
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
              >Expected Delivery</label
            >
            <DatePicker
              v-model="expectedDate"
              date-format="dd M yy"
              placeholder="Expected delivery date"
              show-icon
              show-button-bar
            />
          </div>

          <div class="flex flex-col gap-1.5 md:col-span-2">
            <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
            <Textarea
              v-model="notes"
              rows="2"
              placeholder="Delivery instructions, special requirements…"
              auto-resize
            />
          </div>
        </div>
      </div>

      <!-- Line items (no GST on POs) -->
      <div class="card p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">
            Items Ordered
          </h3>
          <Button severity="secondary" size="small" @click="addLine">
            <Plus class="w-4 h-4" />Add Line
          </Button>
        </div>
        <span v-if="errors.lines" class="text-xs text-red-500">{{ errors.lines }}</span>

        <div
          class="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide px-1"
        >
          <span>Description / Item</span><span>Qty Ordered</span><span>Unit Cost</span
          ><span class="text-right">Line Total</span><span />
        </div>

        <div
          v-for="line in lines"
          :key="line._key"
          class="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 items-start border-b border-surface-100 dark:border-surface-800 pb-4 last:border-0 last:pb-0"
        >
          <div>
            <AutoComplete
              v-model="line.description"
              :suggestions="itemSuggestions[line._key] ?? []"
              option-label="name"
              placeholder="Item or description"
              :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_desc`] }"
              @complete="(e) => onItemSearch(line._key, e)"
              @option-select="(e) => onItemSelect(line, e.value as ItemOption)"
            />
          </div>
          <div>
            <InputText
              v-model="line.qtyOrdered"
              placeholder="1.0000"
              inputmode="decimal"
              class="text-right tabular-nums w-full"
              :class="{ 'p-invalid': errors[`line_${lines.indexOf(line)}_qty`] }"
            />
          </div>
          <div>
            <MoneyInput
              :model-value="line.unitCost"
              :invalid="!!errors[`line_${lines.indexOf(line)}_cost`]"
              @update:model-value="(v) => (line.unitCost = v)"
            />
          </div>
          <div class="text-right">
            <span class="text-sm font-medium tabular-nums text-surface-900 dark:text-surface-50">
              <MoneyCell :amount="lineTotal(line)" />
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
            <div
              class="flex justify-between font-semibold border-t border-surface-200 dark:border-surface-700 pt-2"
            >
              <span class="text-surface-900 dark:text-surface-50">Subtotal</span
              ><MoneyCell :amount="subtotal" />
            </div>
            <p class="text-xs text-surface-400">GST is not applied to purchase orders.</p>
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
