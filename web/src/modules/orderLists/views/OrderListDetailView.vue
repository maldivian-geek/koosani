<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataTable from 'primevue/datatable'
import type { DataTableCellEditCompleteEvent, DataTableCellEditInitEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { Plus, ArrowLeft, ClipboardPaste, Download, FileSpreadsheet } from '@lucide/vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import OrderLineDialog from '../OrderLineDialog.vue'
import OrderListImportDialog from '../OrderListImportDialog.vue'
import { apiFetch, apiFetchDownload, ApiError } from '../../../lib/apiFetch.js'
import { useAuthStore } from '../../../stores/auth.js'
import { OrderListPatch } from '@koosani/shared'

// Quantities transport as NUMERIC strings ("24.0000") — trim insignificant
// trailing decimals for display only; the raw string is what gets patched.
function formatQty(q: string): string {
  return q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q
}

export interface OrderListLine {
  id: string
  orderListId: string
  position: number
  itemName: string
  // The catalogue item's name, resolved server-side by matching itemName
  // (the customer's wording) against items.customer_item_name. Derived,
  // read-only — null when nothing in the item master matches.
  systemItemName: string | null
  qty: string
  uom: string
  note: string | null
  additionalNote: string | null
  paymentStatus: 'pending' | 'paid'
  stockStatus: 'unknown' | 'in_stock' | 'available' | 'not_available'
  boxNo: string | null
  loaded: boolean
}

export interface OrderListDetail {
  id: string
  title: string
  notes: string | null
  lines: OrderListLine[]
}

const PAYMENT_STATUS_OPTIONS = [
  { label: 'Pending', value: 'pending' },
  { label: 'Paid', value: 'paid' },
]

const STOCK_STATUS_OPTIONS = [
  { label: 'Unknown', value: 'unknown' },
  { label: 'In Stock', value: 'in_stock' },
  { label: 'Available', value: 'available' },
  { label: 'Not Available', value: 'not_available' },
]

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const auth = useAuthStore()

const canEdit = computed(() => auth.hasPermission('orders', 'edit'))
const canAdd = computed(() => auth.hasPermission('orders', 'add'))
const canDelete = computed(() => auth.hasPermission('orders', 'delete'))

const orderList = ref<OrderListDetail | null>(null)
const lines = ref<OrderListLine[]>([])
const loading = ref(false)
const notFound = ref(false)
const lineDialogOpen = ref(false)
const importDialogOpen = ref(false)

const titleDraft = ref('')
const notesDraft = ref('')

const id = computed(() => route.params.id as string)

async function load() {
  loading.value = true
  notFound.value = false
  try {
    const data = await apiFetch<OrderListDetail>(`/order-lists/${id.value}`)
    orderList.value = data
    lines.value = data.lines
    titleDraft.value = data.title
    notesDraft.value = data.notes ?? ''
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true
    } else {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Something went wrong. Please try again.',
        life: 5000,
      })
    }
  } finally {
    loading.value = false
  }
}

async function saveHeader() {
  if (!orderList.value) return
  if (
    titleDraft.value === orderList.value.title &&
    notesDraft.value === (orderList.value.notes ?? '')
  )
    return

  const payload = {
    title: titleDraft.value,
    notes: notesDraft.value || null,
  }
  const parsed = OrderListPatch.safeParse(payload)
  if (!parsed.success) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: parsed.error.issues[0]?.message ?? 'Invalid input',
      life: 4000,
    })
    titleDraft.value = orderList.value.title
    notesDraft.value = orderList.value.notes ?? ''
    return
  }

  try {
    const updated = await apiFetch<OrderListDetail>(`/order-lists/${id.value}`, {
      method: 'PATCH',
      body: JSON.stringify(parsed.data),
    })
    if (orderList.value) {
      orderList.value.title = updated.title
      orderList.value.notes = updated.notes
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't save changes. Please try again.",
      life: 5000,
    })
  }
}

// Phase 38 — export. Mirrors EstimateDetailView.vue's downloadPdf handler
// (loading ref, apiFetch → { url } → window.open) and the reports views'
// exportCsv handler (apiFetchDownload — credentialed fetch → blob → object-
// URL anchor click).
function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'list'
}

const downloadingPdf = ref(false)
async function downloadPdf() {
  if (!orderList.value) return
  downloadingPdf.value = true
  try {
    const result = await apiFetch<{ url?: string } | null>(`/order-lists/${id.value}/pdf`)
    if (result?.url) {
      window.open(result.url, '_blank')
    } else {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to generate PDF.',
        life: 4000,
      })
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to generate PDF.',
      life: 4000,
    })
  } finally {
    downloadingPdf.value = false
  }
}

const downloadingCsv = ref(false)
async function downloadCsv() {
  if (!orderList.value) return
  downloadingCsv.value = true
  try {
    await apiFetchDownload(
      `/order-lists/${id.value}/csv`,
      `order-list-${slugifyTitle(orderList.value.title)}.csv`,
    )
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Could not export CSV.', life: 5000 })
  } finally {
    downloadingCsv.value = false
  }
}

function onLineAdded(line: OrderListLine) {
  lines.value.push(line)
  lineDialogOpen.value = false
}

// Mobile text edits go through the line dialog (the desktop table keeps
// inline cell editing, which has no good stacked-card equivalent).
const editLine = ref<OrderListLine | null>(null)

function openEditLine(line: OrderListLine) {
  editLine.value = line
}

function onLineSaved(updated: OrderListLine) {
  const i = lines.value.findIndex((l) => l.id === updated.id)
  if (i !== -1) lines.value[i] = updated
  editLine.value = null
}

function onLinesImported(imported: OrderListLine[]) {
  lines.value.push(...imported)
  importDialogOpen.value = false
}

async function patchLineField(
  lineId: string,
  patch:
    | { paymentStatus: OrderListLine['paymentStatus'] }
    | { stockStatus: OrderListLine['stockStatus'] }
    | { loaded: boolean },
  apply: (row: OrderListLine) => void,
  revert: (row: OrderListLine) => void,
) {
  const row = lines.value.find((l) => l.id === lineId)
  if (!row) return
  apply(row)

  try {
    await apiFetch(`/order-lists/${id.value}/lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  } catch {
    revert(row)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't update status. Please try again.",
      life: 5000,
    })
  }
}

function onPaymentStatusChange(line: OrderListLine, value: OrderListLine['paymentStatus']) {
  const previous = line.paymentStatus
  void patchLineField(
    line.id,
    { paymentStatus: value },
    (row) => (row.paymentStatus = value),
    (row) => (row.paymentStatus = previous),
  )
}

function onStockStatusChange(line: OrderListLine, value: OrderListLine['stockStatus']) {
  const previous = line.stockStatus
  void patchLineField(
    line.id,
    { stockStatus: value },
    (row) => (row.stockStatus = value),
    (row) => (row.stockStatus = previous),
  )
}

function onLoadedChange(line: OrderListLine, value: boolean) {
  const previous = line.loaded
  void patchLineField(
    line.id,
    { loaded: value },
    (row) => (row.loaded = value),
    (row) => (row.loaded = previous),
  )
}

function onDeleteLine(line: OrderListLine) {
  confirm.require({
    header: 'Delete line',
    message: `Remove "${line.itemName}" from this list? This cannot be undone.`,
    acceptProps: { severity: 'danger', label: 'Delete' },
    accept: async () => {
      try {
        await apiFetch(`/order-lists/${id.value}/lines/${line.id}`, { method: 'DELETE' })
        lines.value = lines.value.filter((l) => l.id !== line.id)
      } catch {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: "Couldn't delete this line. Please try again.",
          life: 5000,
        })
      }
    },
  })
}

// Official DataTable prop, not a CSS override (DESIGN.md §2) — a very subtle
// muted-text treatment for not-available rows, not a colored background.
function rowClass(data: OrderListLine) {
  return data.stockStatus === 'not_available' ? 'text-surface-400 dark:text-surface-500' : ''
}

// ─── Inline cell editing (DataTable editMode="cell") ─────────────────────────
// Click a cell → edit → commit (enter/blur) PATCHes just that field, mirroring
// the status dropdowns' optimistic-then-revert behavior.

type EditableField = 'itemName' | 'qty' | 'uom' | 'note' | 'additionalNote' | 'boxNo'
const EDITABLE_FIELDS: readonly EditableField[] = [
  'itemName',
  'qty',
  'uom',
  'note',
  'additionalNote',
  'boxNo',
]

function setField(row: OrderListLine, field: EditableField, value: string | null) {
  if (field === 'note' || field === 'additionalNote' || field === 'boxNo') row[field] = value
  else row[field] = value ?? ''
}

// The editors write into the live row while typing, so snapshot the original
// value at edit start — event.value can already reflect the mutation.
let editSnapshot: string | null = null
function onCellEditInit(event: DataTableCellEditInitEvent) {
  const field = event.field as EditableField
  if (!EDITABLE_FIELDS.includes(field)) return
  editSnapshot = (event.data as OrderListLine)[field] ?? null
}

async function onCellEditComplete(event: DataTableCellEditCompleteEvent) {
  const field = event.field as EditableField
  if (!EDITABLE_FIELDS.includes(field)) return
  const row = event.data as OrderListLine
  const oldValue = editSnapshot
  const raw = ((event.newValue ?? row[field]) as string | null) ?? ''
  const next = raw.trim()

  let patchValue: string | null = next
  if (field === 'itemName') {
    if (!next) {
      setField(row, field, oldValue)
      return
    }
  } else if (field === 'qty') {
    const cleaned = next.replace(/[,\s]/g, '')
    if (!/^\d+(\.\d{1,4})?$/.test(cleaned)) {
      setField(row, field, oldValue)
      toast.add({
        severity: 'warn',
        summary: 'Invalid quantity',
        detail: 'Enter a number, e.g. 24 or 1.5.',
        life: 4000,
      })
      return
    }
    patchValue = cleaned
  } else if (field === 'uom') {
    patchValue = next || 'Each'
  } else {
    patchValue = next || null
  }

  if (patchValue === oldValue) {
    setField(row, field, oldValue)
    return
  }

  setField(row, field, patchValue)
  try {
    const saved = await apiFetch<OrderListLine>(`/order-lists/${id.value}/lines/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: patchValue }),
    })
    // Renaming the item can change which catalogue item it resolves to.
    if (field === 'itemName') row.systemItemName = saved.systemItemName ?? null
  } catch {
    setField(row, field, oldValue)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: "Couldn't save the change. Please try again.",
      life: 5000,
    })
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <button
      class="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900"
      @click="router.push('/order-lists')"
    >
      <ArrowLeft class="w-4 h-4" />
      Back to Order Lists
    </button>

    <div v-if="notFound" class="card p-12 text-center">
      <p class="text-surface-500">This order list was not found.</p>
    </div>

    <template v-else-if="orderList">
      <div class="card p-6 space-y-4">
        <div class="space-y-1.5">
          <label class="block text-sm font-semibold text-surface-800">Title</label>
          <InputText
            v-model="titleDraft"
            class="w-full text-xl font-semibold"
            :disabled="!canEdit"
            @blur="saveHeader"
          />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm font-semibold text-surface-800">Notes</label>
          <Textarea
            v-model="notesDraft"
            rows="2"
            class="w-full resize-none"
            :disabled="!canEdit"
            @blur="saveHeader"
          />
        </div>
      </div>

      <div class="card p-0! overflow-hidden">
        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 border-b border-surface-100 dark:border-surface-800"
        >
          <h3 class="text-base font-medium text-surface-700">Lines</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              severity="secondary"
              size="small"
              :loading="downloadingPdf"
              @click="downloadPdf"
            >
              <Download class="w-4 h-4" />
              PDF
            </Button>
            <Button
              severity="secondary"
              size="small"
              :loading="downloadingCsv"
              @click="downloadCsv"
            >
              <FileSpreadsheet class="w-4 h-4" />
              Excel
            </Button>
            <template v-if="canAdd">
              <Button severity="secondary" size="small" @click="importDialogOpen = true">
                <ClipboardPaste class="w-4 h-4" />
                Import
              </Button>
              <Button severity="secondary" size="small" @click="lineDialogOpen = true">
                <Plus class="w-4 h-4" />
                Add line
              </Button>
            </template>
          </div>
        </div>

        <!-- mobile: purpose-built line cards (DESIGN.md §11 — designed cards
             beat a collapsed 9-column table; empty fields are omitted, not
             dashed). Text edits go through the line dialog via the pencil. -->
        <div class="md:hidden p-3 space-y-2">
          <div v-if="lines.length === 0" class="text-center py-10 text-surface-400 text-sm">
            No lines yet.
          </div>
          <div
            v-for="line in lines"
            :key="line.id"
            class="border border-surface-200 dark:border-surface-700 rounded-lg p-3 space-y-2"
            :class="line.stockStatus === 'not_available' ? 'opacity-60' : ''"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p
                  class="text-sm font-medium text-surface-900 dark:text-surface-50 wrap-break-word"
                >
                  <span class="text-surface-400 mr-1">{{ line.position + 1 }}.</span
                  >{{ line.itemName }}
                </p>
                <p
                  v-if="line.systemItemName"
                  class="text-xs text-surface-500 dark:text-surface-400 mt-0.5"
                >
                  {{ line.systemItemName }}
                </p>
              </div>
              <div class="flex shrink-0">
                <Button
                  v-if="canEdit"
                  icon="pi pi-pencil"
                  text
                  size="small"
                  aria-label="Edit line"
                  @click="openEditLine(line)"
                />
                <Button
                  v-if="canDelete"
                  icon="pi pi-trash"
                  severity="danger"
                  text
                  size="small"
                  aria-label="Delete line"
                  @click="onDeleteLine(line)"
                />
              </div>
            </div>
            <div class="flex items-baseline gap-2 text-sm min-w-0">
              <span class="font-semibold whitespace-nowrap"
                >{{ formatQty(line.qty) }} {{ line.uom }}</span
              >
              <span
                v-if="line.note || line.additionalNote"
                class="text-xs text-surface-500 dark:text-surface-400 truncate"
              >
                {{ [line.note, line.additionalNote].filter(Boolean).join(' · ') }}
              </span>
              <span
                class="ml-auto flex items-center gap-3 whitespace-nowrap text-xs text-surface-600 dark:text-surface-300"
              >
                <span v-if="line.boxNo">Box {{ line.boxNo }}</span>
                <label class="flex items-center gap-1.5">
                  <Checkbox
                    :model-value="line.loaded"
                    binary
                    size="small"
                    :disabled="!canEdit"
                    :aria-label="`Loaded: ${line.itemName}`"
                    @update:model-value="(v) => onLoadedChange(line, !!v)"
                  />
                  Loaded
                </label>
              </span>
            </div>
            <div class="flex gap-2">
              <Select
                :model-value="line.paymentStatus"
                :options="PAYMENT_STATUS_OPTIONS"
                option-label="label"
                option-value="value"
                class="flex-1"
                size="small"
                :disabled="!canEdit"
                @update:model-value="
                  (v) => onPaymentStatusChange(line, v as OrderListLine['paymentStatus'])
                "
              >
                <template #value="{ value }">
                  <StatusTag v-if="value" :status="value" />
                </template>
              </Select>
              <Select
                :model-value="line.stockStatus"
                :options="STOCK_STATUS_OPTIONS"
                option-label="label"
                option-value="value"
                class="flex-1"
                size="small"
                :disabled="!canEdit"
                @update:model-value="
                  (v) => onStockStatusChange(line, v as OrderListLine['stockStatus'])
                "
              >
                <template #value="{ value }">
                  <StatusTag v-if="value" :status="value" />
                </template>
              </Select>
            </div>
          </div>
        </div>

        <DataTable
          class="hidden! md:block!"
          :value="lines"
          :row-class="rowClass"
          striped-rows
          scrollable
          :edit-mode="canEdit ? 'cell' : undefined"
          :pt="{ root: { class: 'text-sm!' } }"
          @cell-edit-init="onCellEditInit"
          @cell-edit-complete="onCellEditComplete"
        >
          <template #empty>
            <div class="text-center py-12 text-surface-400 text-sm">No lines yet.</div>
          </template>

          <Column header="#" style="width: 50px" :pt="stackPt">
            <template #body="{ data }">{{ (data as OrderListLine).position + 1 }}</template>
          </Column>
          <Column field="itemName" header="Item" :pt="stackPt">
            <template #body="{ data }">{{ (data as OrderListLine).itemName }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).itemName"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).itemName = v ?? '')"
              />
            </template>
          </Column>
          <Column header="System Item" :pt="stackPt">
            <template #body="{ data }">
              <span
                v-if="(data as OrderListLine).systemItemName"
                class="text-surface-500 dark:text-surface-400"
              >
                {{ (data as OrderListLine).systemItemName }}
              </span>
              <span v-else class="text-surface-300 dark:text-surface-600">—</span>
            </template>
          </Column>
          <Column field="qty" header="Qty" style="width: 90px" :pt="stackPt">
            <template #body="{ data }">{{ formatQty((data as OrderListLine).qty) }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).qty"
                inputmode="decimal"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).qty = v ?? '')"
              />
            </template>
          </Column>
          <Column field="uom" header="UOM" style="width: 90px" :pt="stackPt">
            <template #body="{ data }">{{ (data as OrderListLine).uom }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).uom"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).uom = v ?? '')"
              />
            </template>
          </Column>
          <Column field="note" header="Note" :pt="stackPt">
            <template #body="{ data }">{{ (data as OrderListLine).note ?? '—' }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).note ?? ''"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).note = v || null)"
              />
            </template>
          </Column>
          <Column field="additionalNote" header="Additional Note" :pt="stackPt">
            <template #body="{ data }">{{
              (data as OrderListLine).additionalNote ?? '—'
            }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).additionalNote ?? ''"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).additionalNote = v || null)"
              />
            </template>
          </Column>
          <Column header="Payment Status" style="width: 160px" :pt="stackPt">
            <template #body="{ data }">
              <Select
                :model-value="(data as OrderListLine).paymentStatus"
                :options="PAYMENT_STATUS_OPTIONS"
                option-label="label"
                option-value="value"
                class="w-full"
                :disabled="!canEdit"
                @update:model-value="
                  (v) =>
                    onPaymentStatusChange(
                      data as OrderListLine,
                      v as OrderListLine['paymentStatus'],
                    )
                "
              >
                <template #value="{ value }">
                  <StatusTag v-if="value" :status="value" />
                </template>
              </Select>
            </template>
          </Column>
          <Column header="Stock Status" style="width: 170px" :pt="stackPt">
            <template #body="{ data }">
              <Select
                :model-value="(data as OrderListLine).stockStatus"
                :options="STOCK_STATUS_OPTIONS"
                option-label="label"
                option-value="value"
                class="w-full"
                :disabled="!canEdit"
                @update:model-value="
                  (v) =>
                    onStockStatusChange(data as OrderListLine, v as OrderListLine['stockStatus'])
                "
              >
                <template #value="{ value }">
                  <StatusTag v-if="value" :status="value" />
                </template>
              </Select>
            </template>
          </Column>
          <Column field="boxNo" header="Box No." style="width: 90px" :pt="stackPt">
            <template #body="{ data }">{{ (data as OrderListLine).boxNo ?? '—' }}</template>
            <template #editor="{ data }">
              <InputText
                :model-value="(data as OrderListLine).boxNo ?? ''"
                class="w-full"
                size="small"
                autofocus
                @update:model-value="(v) => ((data as OrderListLine).boxNo = v || null)"
              />
            </template>
          </Column>
          <Column header="Loaded" style="width: 80px" :pt="stackPt">
            <template #body="{ data }">
              <Checkbox
                :model-value="(data as OrderListLine).loaded"
                binary
                :disabled="!canEdit"
                :aria-label="`Loaded: ${(data as OrderListLine).itemName}`"
                @update:model-value="(v) => onLoadedChange(data as OrderListLine, !!v)"
              />
            </template>
          </Column>
          <Column v-if="canDelete" header="" style="width: 50px" :pt="stackPt">
            <template #body="{ data }">
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                aria-label="Delete line"
                @click="onDeleteLine(data as OrderListLine)"
              />
            </template>
          </Column>
        </DataTable>
      </div>
    </template>

    <OrderLineDialog
      v-if="(lineDialogOpen || editLine) && orderList"
      :order-list-id="orderList.id"
      :line="editLine ?? undefined"
      @close="((lineDialogOpen = false), (editLine = null))"
      @added="onLineAdded"
      @saved="onLineSaved"
    />

    <OrderListImportDialog
      v-if="importDialogOpen && orderList"
      :order-list-id="orderList.id"
      @close="importDialogOpen = false"
      @imported="onLinesImported"
    />
  </div>
</template>
