<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import { useConfirm } from 'primevue/useconfirm'
import { ArrowLeft, Pencil, CheckCircle, XCircle, PackageCheck, FileText } from 'lucide-vue-next'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import MoneyInput from '../../../shared/ui/MoneyInput.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import CustomFieldsPanel from '../../../shared/ui/CustomFieldsPanel.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { money } from '@koosani/shared'

interface PoLine {
  id: string
  itemId: string | null
  description: string
  qtyOrdered: string
  unitCost: string
  qtyReceived: string
  lineTotal: string
  sortOrder: number
}

interface GrnLine {
  id: string
  poLineId: string
  description: string
  qtyReceived: string
  unitCost: string
}

interface Grn {
  id: string
  receivedAt: string
  notes: string | null
  lines: GrnLine[]
}

interface Po {
  id: string
  number: string | null
  supplierId: string
  supplierName: string
  status: string
  orderDate: string | null
  expectedDate: string | null
  notes: string | null
  subtotal: string
  lines: PoLine[]
  grns: Grn[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const poId = computed(() => route.params.id as string)
const po = ref<Po | null>(null)
const loading = ref(false)
const approving = ref(false)
const converting = ref(false)

// ─── Approve ──────────────────────────────────────────────────────────────────

function approvePo() {
  confirm.require({
    message:
      'Approve this purchase order? A PO number will be allocated and the order will be locked.',
    header: 'Approve PO',
    acceptLabel: 'Approve',
    rejectLabel: 'Cancel',
    accept: async () => {
      approving.value = true
      try {
        await apiFetch(`/pos/${poId.value}/approve`, { method: 'POST', body: '{}' })
        toast.add({
          severity: 'success',
          summary: 'Approved',
          detail: 'Purchase order has been approved.',
          life: 3000,
        })
        await load()
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 409
            ? 'This PO cannot be approved in its current state.'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
      } finally {
        approving.value = false
      }
    },
  })
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

const cancelDialogOpen = ref(false)
const cancelReason = ref('')
const cancelling = ref(false)
const cancelError = ref('')

async function submitCancel() {
  cancelError.value = ''
  if (!cancelReason.value.trim()) {
    cancelError.value = 'Reason is required.'
    return
  }
  cancelling.value = true
  try {
    await apiFetch(`/pos/${poId.value}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: cancelReason.value }),
    })
    cancelDialogOpen.value = false
    cancelReason.value = ''
    toast.add({
      severity: 'info',
      summary: 'Cancelled',
      detail: 'Purchase order has been cancelled.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 409
        ? 'This PO cannot be cancelled because goods have already been received.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    cancelling.value = false
  }
}

// ─── GRN dialog ───────────────────────────────────────────────────────────────

interface GrnFormLine {
  poLineId: string
  description: string
  qtyOrdered: string
  qtyReceived: string // form field
  unitCost: string
  included: boolean
}

const grnDialogOpen = ref(false)
const grnReceivedAt = ref<Date>(new Date())
const grnNotes = ref('')
const grnLines = ref<GrnFormLine[]>([])
const grnSaving = ref(false)
const grnErrors = ref<Record<string, string>>({})

function openGrnDialog() {
  grnReceivedAt.value = new Date()
  grnNotes.value = ''
  grnErrors.value = {}
  grnLines.value = (po.value?.lines ?? []).map((l) => ({
    poLineId: l.id,
    description: l.description,
    qtyOrdered: l.qtyOrdered,
    qtyReceived: '0.0000',
    unitCost: l.unitCost,
    included: false,
  }))
  grnDialogOpen.value = true
}

function grnLineTotal(l: GrnFormLine): string {
  try {
    return money.mul(l.qtyReceived || '0', l.unitCost || '0')
  } catch {
    return '0.00'
  }
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function submitGrn() {
  grnErrors.value = {}
  const included = grnLines.value.filter((l) => l.included)
  if (included.length === 0) {
    grnErrors.value.lines = 'Select at least one line to receive.'
    return
  }
  for (const l of included) {
    if (!l.qtyReceived || isNaN(parseFloat(l.qtyReceived)) || parseFloat(l.qtyReceived) <= 0) {
      grnErrors.value[l.poLineId] = 'Enter a valid received quantity.'
    }
  }
  if (Object.keys(grnErrors.value).length > 0) return

  grnSaving.value = true
  try {
    await apiFetch(`/pos/${poId.value}/grns`, {
      method: 'POST',
      body: JSON.stringify({
        receivedAt: toIso(grnReceivedAt.value),
        notes: grnNotes.value || undefined,
        lines: included.map((l) => ({
          poLineId: l.poLineId,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
        })),
      }),
    })
    grnDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'GRN created',
      detail: 'Goods receipt recorded and stock updated.',
      life: 3000,
    })
    await load()
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 409
        ? 'Received quantity exceeds ordered quantity for one or more lines.'
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    grnSaving.value = false
  }
}

// ─── Convert to bill ──────────────────────────────────────────────────────────

function convertToBill() {
  confirm.require({
    message:
      'Create a draft bill from this PO? It will be pre-filled with GRN-received quantities.',
    header: 'Convert to Bill',
    acceptLabel: 'Create Bill',
    rejectLabel: 'Cancel',
    accept: async () => {
      converting.value = true
      try {
        const bill = await apiFetch<{ id: string }>(`/pos/${poId.value}/bill`, {
          method: 'POST',
          body: '{}',
        })
        toast.add({
          severity: 'success',
          summary: 'Bill created',
          detail: 'Draft bill created from GRN quantities.',
          life: 3000,
        })
        void router.push(`/bills/${bill.id}`)
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 409
            ? 'No received goods to bill. Create a GRN first.'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
      } finally {
        converting.value = false
      }
    },
  })
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    po.value = await apiFetch<Po>(`/pos/${poId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/pos')
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

const canReceive = computed(
  () => po.value?.status === 'approved' || po.value?.status === 'partially_received',
)
const canCancel = computed(() => po.value?.status === 'draft' || po.value?.status === 'approved')
const canConvertToBill = computed(
  () =>
    (po.value?.status === 'partially_received' || po.value?.status === 'received') &&
    (po.value?.grns?.length ?? 0) > 0,
)
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/pos')">
        <ArrowLeft class="w-4 h-4" />POs
      </Button>
      <div class="flex-1 min-w-0">
        <div v-if="po" class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50 truncate">
            {{ po.number ?? 'Draft PO' }}
          </h2>
          <StatusTag :status="po.status" />
        </div>
        <div
          v-else-if="loading"
          class="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse"
        />
      </div>

      <div v-if="po" class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="po.status === 'draft'"
          severity="secondary"
          @click="() => void router.push(`/pos/${poId}/edit`)"
        >
          <Pencil class="w-4 h-4" />Edit
        </Button>
        <Button v-if="po.status === 'draft'" :loading="approving" @click="approvePo">
          <CheckCircle class="w-4 h-4" />Approve
        </Button>
        <Button v-if="canReceive" @click="openGrnDialog">
          <PackageCheck class="w-4 h-4" />Receive Goods
        </Button>
        <Button
          v-if="canConvertToBill"
          severity="secondary"
          :loading="converting"
          @click="convertToBill"
        >
          <FileText class="w-4 h-4" />Convert to Bill
        </Button>
        <Button v-if="canCancel" severity="danger" outlined @click="cancelDialogOpen = true">
          <XCircle class="w-4 h-4" />Cancel
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="po">
      <!-- Summary -->
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Supplier
            </p>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ po.supplierName }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Order Date
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="po.orderDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Expected Delivery
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="po.expectedDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Subtotal
            </p>
            <p class="text-sm font-semibold text-surface-900 dark:text-surface-50 tabular-nums">
              <MoneyCell :amount="po.subtotal" />
            </p>
          </div>
        </div>
        <div v-if="po.notes" class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Notes
          </p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ po.notes }}
          </p>
        </div>
      </div>

      <!-- Lines table -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Items Ordered</h3>
        </div>
        <DataTable :value="po.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qtyOrdered" header="Qty Ordered" class="text-right tabular-nums" />
          <Column field="qtyReceived" header="Qty Received" class="text-right tabular-nums">
            <template #body="{ data }">
              <span
                :class="
                  parseFloat((data as PoLine).qtyReceived) > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-surface-400'
                "
              >
                {{ (data as PoLine).qtyReceived }}
              </span>
            </template>
          </Column>
          <Column field="unitCost" header="Unit Cost" class="text-right">
            <template #body="{ data }"><MoneyCell :amount="(data as PoLine).unitCost" /></template>
          </Column>
          <Column field="lineTotal" header="Total" class="text-right">
            <template #body="{ data }"><MoneyCell :amount="(data as PoLine).lineTotal" /></template>
          </Column>
        </DataTable>
      </div>

      <!-- GRNs -->
      <div v-if="po.grns.length > 0" class="space-y-4">
        <h3 class="text-base font-medium text-surface-700 dark:text-surface-300 px-1">
          Goods Receipts
        </h3>
        <div v-for="grn in po.grns" :key="grn.id" class="card overflow-hidden p-0!">
          <div
            class="px-6 py-3 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
          >
            <div>
              <span class="text-sm font-medium text-surface-700 dark:text-surface-300"
                >Received
              </span>
              <DateCell :date="grn.receivedAt" />
            </div>
            <span v-if="grn.notes" class="text-xs text-surface-400 truncate max-w-xs">{{
              grn.notes
            }}</span>
          </div>
          <DataTable :value="grn.lines" :pt="{ root: { class: 'text-sm!' } }">
            <Column field="description" header="Item" />
            <Column field="qtyReceived" header="Qty Received" class="text-right tabular-nums" />
            <Column field="unitCost" header="Unit Cost" class="text-right">
              <template #body="{ data }"
                ><MoneyCell :amount="(data as GrnLine).unitCost"
              /></template>
            </Column>
          </DataTable>
        </div>
      </div>

      <CustomFieldsPanel doc-type="po" :doc-id="poId" />
    </template>
  </div>

  <!-- Cancel dialog -->
  <Dialog
    v-model:visible="cancelDialogOpen"
    header="Cancel Purchase Order"
    modal
    :style="{ width: '30rem' }"
    @hide="
      cancelReason = ''
      cancelError = ''
    "
  >
    <div class="space-y-4">
      <p class="text-sm text-surface-600 dark:text-surface-400">
        Cancelling the PO will prevent it from being approved or receiving any goods. This cannot be
        undone if goods have already been received.
      </p>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Reason <span class="text-red-500">*</span></label
        >
        <Textarea
          v-model="cancelReason"
          rows="3"
          placeholder="Reason for cancellation…"
          :class="{ 'p-invalid': cancelError }"
          auto-resize
        />
        <span v-if="cancelError" class="text-xs text-red-500">{{ cancelError }}</span>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="cancelDialogOpen = false">Back</Button>
      <Button severity="danger" :loading="cancelling" @click="submitCancel">Cancel PO</Button>
    </template>
  </Dialog>

  <!-- GRN dialog -->
  <Dialog
    v-model:visible="grnDialogOpen"
    header="Receive Goods"
    modal
    :style="{ width: '48rem' }"
    @hide="grnNotes = ''"
  >
    <div class="space-y-5">
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
            >Received Date <span class="text-red-500">*</span></label
          >
          <DatePicker v-model="grnReceivedAt" date-format="dd M yy" show-icon />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
          <InputText v-model="grnNotes" placeholder="Optional notes for this receipt" />
        </div>
      </div>

      <span v-if="grnErrors.lines" class="text-xs text-red-500 block">{{ grnErrors.lines }}</span>

      <!-- Line table -->
      <div class="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-surface-50 dark:bg-surface-800">
            <tr>
              <th class="w-10 px-3 py-2" />
              <th class="text-left px-3 py-2 font-medium text-surface-600 dark:text-surface-400">
                Item
              </th>
              <th
                class="text-right px-3 py-2 font-medium text-surface-600 dark:text-surface-400 w-28"
              >
                Ordered
              </th>
              <th
                class="text-right px-3 py-2 font-medium text-surface-600 dark:text-surface-400 w-32"
              >
                Received
              </th>
              <th
                class="text-right px-3 py-2 font-medium text-surface-600 dark:text-surface-400 w-32"
              >
                Unit Cost
              </th>
              <th
                class="text-right px-3 py-2 font-medium text-surface-600 dark:text-surface-400 w-28"
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in grnLines"
              :key="line.poLineId"
              class="border-t border-surface-100 dark:border-surface-800"
              :class="line.included ? 'bg-surface-0 dark:bg-surface-900' : 'opacity-50'"
            >
              <td class="px-3 py-2 text-center">
                <input v-model="line.included" type="checkbox" class="rounded" />
              </td>
              <td class="px-3 py-2 text-surface-700 dark:text-surface-300">
                {{ line.description }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-surface-500">
                {{ line.qtyOrdered }}
              </td>
              <td class="px-3 py-2">
                <InputText
                  v-model="line.qtyReceived"
                  :disabled="!line.included"
                  inputmode="decimal"
                  class="text-right tabular-nums w-full text-sm"
                  :class="{ 'p-invalid': grnErrors[line.poLineId] }"
                />
                <span v-if="grnErrors[line.poLineId]" class="text-xs text-red-500">{{
                  grnErrors[line.poLineId]
                }}</span>
              </td>
              <td class="px-3 py-2">
                <MoneyInput
                  :model-value="line.unitCost"
                  :disabled="!line.included"
                  @update:model-value="(v) => (line.unitCost = v)"
                />
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-surface-700 dark:text-surface-300">
                <MoneyCell v-if="line.included" :amount="grnLineTotal(line)" />
                <span v-else class="text-surface-300 dark:text-surface-600">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer>
      <Button severity="secondary" outlined @click="grnDialogOpen = false">Cancel</Button>
      <Button :loading="grnSaving" @click="submitGrn">
        <PackageCheck class="w-4 h-4" />Record Receipt
      </Button>
    </template>
  </Dialog>
</template>
