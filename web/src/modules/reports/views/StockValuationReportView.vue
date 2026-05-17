<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import { ArrowLeft, Download } from 'lucide-vue-next'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, apiFetchDownload } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { todayMv } from '@koosani/shared'

interface StockValuationRow {
  itemId: string
  itemName: string
  sku: string
  qty: string
  avgCost: string
  value: string
}

interface ReportResult {
  asOf: string
  method: string
  rows: StockValuationRow[]
}

const router = useRouter()
const toast = useToast()

const today = todayMv()
const asOf = ref<Date>(new Date(today))
const method = ref<'avg' | 'fifo'>('avg')
const methodOptions = [
  { label: 'Weighted Average', value: 'avg' },
  { label: 'FIFO', value: 'fifo' },
]

const rows = ref<StockValuationRow[]>([])
const loading = ref(false)
const csvLoading = ref(false)

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function totalValue(): string {
  return rows.value.reduce((s, r) => s + parseFloat(r.value), 0).toFixed(2)
}

async function run() {
  loading.value = true
  try {
    const asOfStr = formatDate(asOf.value)
    const data = await apiFetch<ReportResult>(
      `/reports/stock-valuation?asOf=${asOfStr}&method=${method.value}`,
    )
    rows.value = data.rows
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load stock valuation.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

async function exportCsv() {
  csvLoading.value = true
  try {
    const asOfStr = formatDate(asOf.value)
    await apiFetchDownload(
      `/reports/stock-valuation?asOf=${asOfStr}&method=${method.value}&format=csv`,
      `stock-valuation-${asOfStr}.csv`,
    )
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Could not export CSV.', life: 5000 })
  } finally {
    csvLoading.value = false
  }
}

onMounted(() => void run())
</script>

<template>
  <div class="space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/reports')">
        <ArrowLeft class="w-4 h-4" />Reports
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          Stock Valuation
        </h2>
      </div>
    </div>

    <div class="card p-5">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">As of</label>
          <DatePicker v-model="asOf" date-format="dd M yy" show-icon show-button-bar />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300"
            >Valuation method</label
          >
          <Select
            v-model="method"
            :options="methodOptions"
            option-label="label"
            option-value="value"
          />
        </div>
        <Button :loading="loading" @click="() => void run()">Apply</Button>
        <Button severity="secondary" :loading="csvLoading" @click="() => void exportCsv()">
          <Download class="w-4 h-4" />CSV
        </Button>
      </div>
    </div>

    <div class="card overflow-hidden p-0!">
      <DataTable :value="rows" :loading="loading" :pt="{ root: { class: 'text-sm!' } }">
        <template #empty>
          <div class="text-center py-10 text-sm text-surface-400">No stock data.</div>
        </template>
        <Column field="itemName" header="Item" />
        <Column field="sku" header="SKU" style="width: 130px">
          <template #body="{ data }">
            <span class="font-mono text-xs text-surface-500">{{
              (data as StockValuationRow).sku
            }}</span>
          </template>
        </Column>
        <Column field="qty" header="Qty" class="text-right" style="width: 100px">
          <template #body="{ data }">
            <span class="tabular-nums">{{ (data as StockValuationRow).qty }}</span>
          </template>
        </Column>
        <Column field="avgCost" header="Avg Cost" class="text-right" style="width: 130px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as StockValuationRow).avgCost" />
          </template>
        </Column>
        <Column field="value" header="Value" class="text-right" style="width: 140px">
          <template #body="{ data }">
            <span class="font-semibold tabular-nums">
              <MoneyCell :amount="(data as StockValuationRow).value" />
            </span>
          </template>
        </Column>

        <template #footer>
          <tr v-if="rows.length > 0">
            <td
              colspan="4"
              class="text-right font-medium text-sm pr-4 py-3 text-surface-700 dark:text-surface-300"
            >
              Total Value
            </td>
            <td
              class="text-right font-bold tabular-nums pr-4 py-3 text-surface-900 dark:text-surface-50"
            >
              <MoneyCell :amount="totalValue()" />
            </td>
          </tr>
        </template>
      </DataTable>
    </div>
  </div>
</template>
