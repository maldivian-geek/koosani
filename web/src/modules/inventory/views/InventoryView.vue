<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import AutoComplete from 'primevue/autocomplete'
import { ClipboardList, SlidersHorizontal } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface OnHandRow {
  itemId: string
  sku: string
  name: string
  unit: string
  stockOnHand: string
  reorderPoint: string | null
}

interface ItemOption {
  id: string
  name: string
  sku: string
}

const router = useRouter()
const toast = useToast()

const rows = ref<OnHandRow[]>([])
const loading = ref(false)
const belowReorderOnly = ref(false)

function isBelowReorder(row: OnHandRow): boolean {
  return row.reorderPoint !== null && parseFloat(row.stockOnHand) < parseFloat(row.reorderPoint)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (belowReorderOnly.value) params.set('belowReorder', 'true')
    rows.value = await apiFetch<OnHandRow[]>(`/inventory/on-hand?${params}`)
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

// ─── Adjustment dialog ────────────────────────────────────────────────────────
const adjustOpen = ref(false)
const adjustItem = ref<ItemOption | null>(null)
const adjustItemSuggestions = ref<ItemOption[]>([])
const adjustQty = ref('')
const adjustReason = ref('')
const adjustSaving = ref(false)
const adjustError = ref('')

function openAdjust() {
  adjustItem.value = null
  adjustQty.value = ''
  adjustReason.value = ''
  adjustError.value = ''
  adjustOpen.value = true
}

async function searchItems(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true' })
    const data = await apiFetch<ItemOption[] | { items: ItemOption[] }>(`/items?${params}`)
    adjustItemSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    adjustItemSuggestions.value = []
  }
}

async function submitAdjust() {
  adjustError.value = ''
  const qty = parseFloat(adjustQty.value)
  if (!adjustItem.value) {
    adjustError.value = 'Select an item.'
    return
  }
  if (isNaN(qty) || qty === 0) {
    adjustError.value = 'Enter a non-zero quantity (positive to add stock, negative to remove).'
    return
  }
  if (!adjustReason.value.trim()) {
    adjustError.value = 'A reason is required.'
    return
  }
  adjustSaving.value = true
  try {
    await apiFetch('/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({
        itemId: adjustItem.value.id,
        qty: qty.toFixed(4),
        reason: adjustReason.value,
      }),
    })
    adjustOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Adjusted',
      detail: 'Stock adjustment recorded.',
      life: 3000,
    })
    await load()
  } catch (err) {
    adjustError.value =
      err instanceof ApiError && err.status === 422
        ? 'This adjustment is not allowed (check available stock).'
        : "Couldn't record the adjustment. Please try again."
  } finally {
    adjustSaving.value = false
  }
}

// ─── Stock count dialog ───────────────────────────────────────────────────────
const countOpen = ref(false)
const countValues = ref<Record<string, string>>({})
const countSaving = ref(false)

function openCount() {
  countValues.value = Object.fromEntries(rows.value.map((r) => [r.itemId, r.stockOnHand]))
  countOpen.value = true
}

async function submitCount() {
  const counts = Object.entries(countValues.value)
    .filter(([, qty]) => qty !== '' && !isNaN(parseFloat(qty)))
    .map(([itemId, qty]) => ({ itemId, qty: parseFloat(qty).toFixed(4) }))

  if (counts.length === 0) {
    countOpen.value = false
    return
  }

  countSaving.value = true
  try {
    const result = await apiFetch<{ adjustmentsCreated: number }>('/inventory/stock-count', {
      method: 'POST',
      body: JSON.stringify({ counts }),
    })
    countOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Stock count applied',
      detail: `${result.adjustmentsCreated} adjustment(s) created from variances.`,
      life: 4000,
    })
    await load()
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't apply the stock count.",
      life: 5000,
    })
  } finally {
    countSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900">Inventory</h2>
        <p class="text-surface-500 mt-0.5">
          Stock on hand, adjustments, and physical stock counts.
        </p>
      </div>
      <div class="flex gap-2">
        <Button severity="secondary" @click="() => void router.push('/inventory/movements')">
          <ClipboardList class="w-4 h-4" />
          Movement Ledger
        </Button>
        <Button severity="secondary" @click="openCount">
          <SlidersHorizontal class="w-4 h-4" />
          Stock Count
        </Button>
        <Button @click="openAdjust">Adjust Stock</Button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Checkbox
        v-model="belowReorderOnly"
        binary
        input-id="below-reorder"
        @update:model-value="load"
      />
      <label for="below-reorder" class="text-sm text-surface-600 dark:text-surface-300">
        Show only items below reorder point
      </label>
    </div>

    <div class="card overflow-hidden p-0!">
      <DataTable
        :value="rows"
        :loading="loading"
        striped-rows
        :pt="{ root: { class: 'text-sm!' } }"
      >
        <template #empty>No items found.</template>
        <Column field="sku" header="SKU" style="width: 140px" />
        <Column field="name" header="Item" />
        <Column field="unit" header="Unit" style="width: 90px" />
        <Column header="On hand" class="text-right" style="width: 120px">
          <template #body="{ data }">
            <span :class="isBelowReorder(data as OnHandRow) ? 'text-red-500 font-semibold' : ''">
              {{ (data as OnHandRow).stockOnHand }}
            </span>
          </template>
        </Column>
        <Column header="Reorder point" class="text-right" style="width: 130px">
          <template #body="{ data }">{{ (data as OnHandRow).reorderPoint ?? '—' }}</template>
        </Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="adjustOpen" header="Adjust Stock" modal :style="{ width: '28rem' }">
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Item</label>
          <AutoComplete
            v-model="adjustItem"
            :suggestions="adjustItemSuggestions"
            option-label="name"
            placeholder="Search items…"
            fluid
            @complete="searchItems"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Quantity delta</label>
          <InputText v-model="adjustQty" inputmode="decimal" placeholder="e.g. 10 or -5" fluid />
          <small class="text-surface-400">Positive adds stock, negative removes it.</small>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Reason</label>
          <Textarea
            v-model="adjustReason"
            rows="2"
            placeholder="e.g. damaged goods write-off"
            fluid
          />
        </div>
        <small v-if="adjustError" class="text-red-500">{{ adjustError }}</small>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="adjustOpen = false" />
        <Button label="Adjust" :loading="adjustSaving" @click="submitAdjust" />
      </template>
    </Dialog>

    <Dialog v-model:visible="countOpen" header="Stock Count" modal :style="{ width: '36rem' }">
      <p class="text-sm text-surface-500 mb-4">
        Enter the physically counted quantity for each item. Only changed values create an
        adjustment.
      </p>
      <div class="space-y-2 max-h-96 overflow-y-auto">
        <div
          v-for="row in rows"
          :key="row.itemId"
          class="flex items-center justify-between gap-3 text-sm"
        >
          <span class="flex-1"
            >{{ row.name }} <span class="text-surface-400">({{ row.sku }})</span></span
          >
          <InputText v-model="countValues[row.itemId]" inputmode="decimal" class="w-28" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="countOpen = false" />
        <Button label="Apply Count" :loading="countSaving" @click="submitCount" />
      </template>
    </Dialog>
  </div>
</template>
