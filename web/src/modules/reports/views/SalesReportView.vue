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
import { todayMv, startOfMvMonth } from '@koosani/shared'

interface NetGroupRow {
  groupKey: string
  label: string
  docCount: number
  subtotal: string
  gstAmount: string
  total: string
}

interface ReportResult {
  from: string
  to: string
  groupBy: string
  rows: NetGroupRow[]
}

const router = useRouter()
const toast = useToast()

const today = todayMv()
const monthStart = startOfMvMonth(today)

const fromDate = ref<Date>(new Date(monthStart))
const toDate = ref<Date>(new Date(today))
const groupBy = ref<'customer' | 'item' | 'day'>('customer')
const groupByOptions = [
  { label: 'By Customer', value: 'customer' },
  { label: 'By Item', value: 'item' },
  { label: 'By Day', value: 'day' },
]

const rows = ref<NetGroupRow[]>([])
const loading = ref(false)
const csvLoading = ref(false)

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function run() {
  loading.value = true
  try {
    const from = formatDate(fromDate.value)
    const to = formatDate(toDate.value)
    const data = await apiFetch<ReportResult>(
      `/reports/sales?from=${from}&to=${to}&groupBy=${groupBy.value}`,
    )
    rows.value = data.rows
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load sales report.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

async function exportCsv() {
  csvLoading.value = true
  try {
    const from = formatDate(fromDate.value)
    const to = formatDate(toDate.value)
    await apiFetchDownload(
      `/reports/sales?from=${from}&to=${to}&groupBy=${groupBy.value}&format=csv`,
      `sales-${from}-${to}.csv`,
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
    <!-- Header -->
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/reports')">
        <ArrowLeft class="w-4 h-4" />Reports
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Sales Report</h2>
      </div>
    </div>

    <!-- Filters -->
    <div class="card p-5">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">From</label>
          <DatePicker v-model="fromDate" date-format="dd M yy" show-icon show-button-bar />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">To</label>
          <DatePicker v-model="toDate" date-format="dd M yy" show-icon show-button-bar />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Group by</label>
          <Select
            v-model="groupBy"
            :options="groupByOptions"
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

    <!-- Results table -->
    <div class="card overflow-hidden p-0!">
      <DataTable :value="rows" :loading="loading" :pt="{ root: { class: 'text-sm!' } }">
        <template #empty>
          <div class="text-center py-10 text-sm text-surface-400">No results for this period.</div>
        </template>
        <Column field="label" header="Group" />
        <Column field="docCount" header="Docs" style="width: 80px" class="text-right" />
        <Column field="subtotal" header="Subtotal" class="text-right" style="width: 140px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as NetGroupRow).subtotal" />
          </template>
        </Column>
        <Column field="gstAmount" header="GST" class="text-right" style="width: 130px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as NetGroupRow).gstAmount" />
          </template>
        </Column>
        <Column field="total" header="Total" class="text-right" style="width: 140px">
          <template #body="{ data }">
            <span class="font-semibold tabular-nums">
              <MoneyCell :amount="(data as NetGroupRow).total" />
            </span>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
