<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import DatePicker from 'primevue/datepicker'
import { ArrowLeft, Download } from 'lucide-vue-next'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, apiFetchDownload } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { todayMv, startOfMvMonth } from '@koosani/shared'

interface CategoryBreakdown {
  category: string
  taxableSupplies: string
  tax: string
}

interface GstSummaryResult {
  from: string
  to: string
  outputTaxByCategory: CategoryBreakdown[]
  inputTaxByCategory: CategoryBreakdown[]
  totalOutputTax: string
  totalInputTax: string
  netPayable: string
}

const router = useRouter()
const toast = useToast()

const today = todayMv()
const monthStart = startOfMvMonth(today)

const fromDate = ref<Date>(new Date(monthStart))
const toDate = ref<Date>(new Date(today))
const result = ref<GstSummaryResult | null>(null)
const loading = ref(false)
const csvLoading = ref(false)

const categoryLabels: Record<string, string> = {
  general_8: 'General (8%)',
  tourism_16: 'Tourism (16%)',
  tourism_17: 'Tourism (17%)',
  zero: 'Zero-rated',
  exempt: 'Exempt',
}

function categoryLabel(cat: string): string {
  return categoryLabels[cat] ?? cat
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function run() {
  loading.value = true
  try {
    const from = formatDate(fromDate.value)
    const to = formatDate(toDate.value)
    result.value = await apiFetch<GstSummaryResult>(`/reports/gst-summary?from=${from}&to=${to}`)
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load GST summary.',
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
      `/reports/gst-summary?from=${from}&to=${to}&format=csv`,
      `gst-summary-${from}-${to}.csv`,
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
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">GST Summary</h2>
        <p class="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
          Live preview — no period lock is required.
        </p>
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
        <Button :loading="loading" @click="() => void run()">Apply</Button>
        <Button severity="secondary" :loading="csvLoading" @click="() => void exportCsv()">
          <Download class="w-4 h-4" />CSV
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-400 text-sm">Loading…</div>

    <template v-else-if="result">
      <!-- Summary totals -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Output Tax
          </p>
          <p class="text-xl font-semibold tabular-nums text-surface-900 dark:text-surface-50">
            <MoneyCell :amount="result.totalOutputTax" />
          </p>
        </div>
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Input Tax
          </p>
          <p class="text-xl font-semibold tabular-nums text-surface-900 dark:text-surface-50">
            <MoneyCell :amount="result.totalInputTax" />
          </p>
        </div>
        <div class="card p-5">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Net Payable
          </p>
          <p
            class="text-xl font-semibold tabular-nums"
            :class="
              parseFloat(result.netPayable) > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400'
            "
          >
            <MoneyCell :amount="result.netPayable" />
          </p>
        </div>
      </div>

      <!-- Output tax breakdown -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Output Tax by Category
          </h3>
        </div>
        <DataTable :value="result.outputTaxByCategory" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>
            <div class="text-center py-6 text-sm text-surface-400">No output tax.</div>
          </template>
          <Column field="category" header="Category">
            <template #body="{ data }">
              {{ categoryLabel((data as CategoryBreakdown).category) }}
            </template>
          </Column>
          <Column
            field="taxableSupplies"
            header="Taxable Supplies"
            class="text-right"
            style="width: 180px"
          >
            <template #body="{ data }">
              <MoneyCell :amount="(data as CategoryBreakdown).taxableSupplies" />
            </template>
          </Column>
          <Column field="tax" header="Tax" class="text-right" style="width: 140px">
            <template #body="{ data }">
              <span class="font-medium tabular-nums">
                <MoneyCell :amount="(data as CategoryBreakdown).tax" />
              </span>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Input tax breakdown -->
      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Input Tax by Category
          </h3>
        </div>
        <DataTable :value="result.inputTaxByCategory" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>
            <div class="text-center py-6 text-sm text-surface-400">No input tax.</div>
          </template>
          <Column field="category" header="Category">
            <template #body="{ data }">
              {{ categoryLabel((data as CategoryBreakdown).category) }}
            </template>
          </Column>
          <Column
            field="taxableSupplies"
            header="Taxable Purchases"
            class="text-right"
            style="width: 180px"
          >
            <template #body="{ data }">
              <MoneyCell :amount="(data as CategoryBreakdown).taxableSupplies" />
            </template>
          </Column>
          <Column field="tax" header="Tax" class="text-right" style="width: 140px">
            <template #body="{ data }">
              <span class="font-medium tabular-nums">
                <MoneyCell :amount="(data as CategoryBreakdown).tax" />
              </span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>
