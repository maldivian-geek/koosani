<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import { TrendingUp, TrendingDown, Package, ExternalLink } from '@lucide/vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import BarChart from '../../../shared/ui/BarChart.vue'
import { apiFetch } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '../../../stores/auth.js'
import { todayMv, startOfMvMonth } from '@koosani/shared'

interface NetGroupRow {
  groupKey: string
  label: string
  docCount: number
  subtotal: string
  gstAmount: string
  total: string
}

interface AgedEntityRow {
  entityId: string
  entityName: string
  current: string
  days1_30: string
  days31_60: string
  days61_90: string
  days91Plus: string
  total: string
}

interface OnHandItem {
  item: { id: string; name: string; sku: string; reorderPoint: string | null }
  qty: string
}

interface GstSummaryResult {
  from: string
  to: string
  totalOutputTax: string
  totalInputTax: string
  netPayable: string
}

const router = useRouter()
const toast = useToast()
const authStore = useAuthStore()

const today = todayMv()
const monthStart = startOfMvMonth(today)

const salesRows = ref<NetGroupRow[]>([])
const purchasesRows = ref<NetGroupRow[]>([])
const arRows = ref<AgedEntityRow[]>([])
const lowStockItems = ref<OnHandItem[]>([])
const gstPreview = ref<GstSummaryResult | null>(null)
const loading = ref(false)

const totalSales = computed(() =>
  salesRows.value.reduce((s, r) => s + parseFloat(r.total), 0).toFixed(2),
)

const totalPurchases = computed(() =>
  purchasesRows.value.reduce((s, r) => s + parseFloat(r.total), 0).toFixed(2),
)

const top5Ar = computed(() =>
  [...arRows.value].sort((a, b) => parseFloat(b.total) - parseFloat(a.total)).slice(0, 5),
)

const chartLabels = computed(() => salesRows.value.map((r) => r.label || r.groupKey))
const chartDatasets = computed(() => [
  { label: 'Daily Sales', data: salesRows.value.map((r) => parseFloat(r.total)) },
])

async function loadAll() {
  loading.value = true
  const qs = `from=${monthStart}&to=${today}`
  const [salesData, purchasesData, arData, stockData, gstData] = await Promise.allSettled([
    apiFetch<{ rows: NetGroupRow[] }>(`/reports/sales?${qs}&groupBy=day`),
    apiFetch<{ rows: NetGroupRow[] }>(`/reports/purchases?${qs}&groupBy=day`),
    apiFetch<{ rows: AgedEntityRow[] }>(`/reports/aged-receivables?asOf=${today}`),
    apiFetch<OnHandItem[]>('/inventory/on-hand?belowReorder=true'),
    apiFetch<GstSummaryResult>(`/reports/gst-summary?${qs}`),
  ])

  if (salesData.status === 'fulfilled') salesRows.value = salesData.value.rows
  if (purchasesData.status === 'fulfilled') purchasesRows.value = purchasesData.value.rows
  if (arData.status === 'fulfilled') arRows.value = arData.value.rows
  if (stockData.status === 'fulfilled') lowStockItems.value = stockData.value
  if (gstData.status === 'fulfilled') gstPreview.value = gstData.value

  const anyFailed = [salesData, purchasesData, arData, stockData, gstData].some(
    (r) => r.status === 'rejected',
  )
  if (anyFailed) {
    toast.add({
      severity: 'warn',
      summary: 'Partial data',
      detail: 'Some dashboard data could not be loaded.',
      life: 4000,
    })
  }
  loading.value = false
}

onMounted(() => void loadAll())
</script>

<template>
  <div class="space-y-6">
    <!-- Welcome -->
    <div>
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
        Welcome back, {{ authStore.user?.name?.split(' ')[0] ?? 'there' }}
      </h2>
      <p class="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
        Here's what's happening this month.
      </p>
    </div>

    <!-- KPI cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="card p-5">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide">
            Sales (this month)
          </p>
          <TrendingUp class="w-4 h-4 text-indigo-500" />
        </div>
        <p class="text-2xl font-semibold tabular-nums text-surface-900 dark:text-surface-50">
          <MoneyCell :amount="totalSales" />
        </p>
      </div>
      <div class="card p-5">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide">
            Purchases (this month)
          </p>
          <TrendingDown class="w-4 h-4 text-rose-500" />
        </div>
        <p class="text-2xl font-semibold tabular-nums text-surface-900 dark:text-surface-50">
          <MoneyCell :amount="totalPurchases" />
        </p>
      </div>
    </div>

    <!-- Sales chart -->
    <div class="card p-6">
      <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-4">
        Daily Sales —
        {{ new Date(monthStart).toLocaleString('en', { month: 'long', year: 'numeric' }) }}
      </h3>
      <div v-if="salesRows.length > 0">
        <BarChart :labels="chartLabels" :datasets="chartDatasets" :height="200" />
      </div>
      <div v-else class="text-center py-10 text-sm text-surface-400">
        No sales data for this period.
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Top 5 AR customers -->
      <div class="card overflow-hidden p-0!">
        <div
          class="px-6 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
        >
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Top 5 Outstanding AR
          </h3>
          <button
            class="text-xs text-indigo-500 hover:underline"
            @click="() => void router.push('/reports/aged-receivables')"
          >
            View report
          </button>
        </div>
        <DataTable :value="top5Ar" :loading="loading" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>
            <div class="text-center py-8 text-sm text-surface-400">No outstanding receivables.</div>
          </template>
          <Column field="entityName" header="Customer" />
          <Column field="total" header="Outstanding" class="text-right" style="width: 140px">
            <template #body="{ data }">
              <span class="tabular-nums font-medium text-amber-600 dark:text-amber-400">
                <MoneyCell :amount="(data as AgedEntityRow).total" />
              </span>
            </template>
          </Column>
          <Column header="" style="width: 44px">
            <template #body="{ data }">
              <button
                class="text-surface-400 hover:text-indigo-500"
                @click="
                  () => void router.push(`/customers/${(data as AgedEntityRow).entityId}/soa`)
                "
              >
                <ExternalLink class="w-3.5 h-3.5" />
              </button>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Low stock items -->
      <div class="card overflow-hidden p-0!">
        <div
          class="px-6 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
        >
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            <Package class="w-4 h-4 inline-block mr-1.5 text-amber-500" />Low Stock
          </h3>
          <button
            class="text-xs text-indigo-500 hover:underline"
            @click="() => void router.push('/reports/stock-valuation')"
          >
            View report
          </button>
        </div>
        <DataTable :value="lowStockItems" :loading="loading" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>
            <div class="text-center py-8 text-sm text-surface-400">
              All items are sufficiently stocked.
            </div>
          </template>
          <Column field="item.name" header="Item" />
          <Column field="item.sku" header="SKU" style="width: 120px">
            <template #body="{ data }">
              <span class="font-mono text-xs text-surface-500">{{
                (data as OnHandItem).item.sku
              }}</span>
            </template>
          </Column>
          <Column field="qty" header="On Hand" class="text-right" style="width: 100px">
            <template #body="{ data }">
              <span class="tabular-nums font-medium text-rose-600 dark:text-rose-400">
                {{ (data as OnHandItem).qty }}
              </span>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- GST preview -->
    <div v-if="gstPreview" class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
          GST Preview — this month
        </h3>
        <button
          class="text-xs text-indigo-500 hover:underline"
          @click="() => void router.push('/gst')"
        >
          View periods
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Output Tax</p>
          <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
            <MoneyCell :amount="gstPreview.totalOutputTax" />
          </p>
        </div>
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Input Tax</p>
          <p class="text-base font-semibold tabular-nums text-surface-900 dark:text-surface-50">
            <MoneyCell :amount="gstPreview.totalInputTax" />
          </p>
        </div>
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-0.5">Net Payable</p>
          <p
            class="text-base font-semibold tabular-nums"
            :class="
              parseFloat(gstPreview.netPayable) > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400'
            "
          >
            <MoneyCell :amount="gstPreview.netPayable" />
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
