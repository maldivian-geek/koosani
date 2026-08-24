<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import DatePicker from 'primevue/datepicker'
import { ArrowLeft, Download, ExternalLink } from '@lucide/vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import { apiFetch, apiFetchDownload } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { todayMv } from '@koosani/shared'

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

interface ReportResult {
  asOf: string
  rows: AgedEntityRow[]
}

const router = useRouter()
const toast = useToast()

const today = todayMv()
const asOf = ref<Date>(new Date(today))
const rows = ref<AgedEntityRow[]>([])
const loading = ref(false)
const csvLoading = ref(false)

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function run() {
  loading.value = true
  try {
    const data = await apiFetch<ReportResult>(
      `/reports/aged-receivables?asOf=${formatDate(asOf.value)}`,
    )
    rows.value = data.rows
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not load aged receivables.',
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
      `/reports/aged-receivables?asOf=${asOfStr}&format=csv`,
      `aged-receivables-${asOfStr}.csv`,
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
          Aged Receivables
        </h2>
      </div>
    </div>

    <div class="card p-5">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-surface-700 dark:text-surface-300">As of</label>
          <DatePicker v-model="asOf" date-format="dd M yy" show-icon show-button-bar />
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
          <div class="text-center py-10 text-sm text-surface-400">No outstanding receivables.</div>
        </template>
        <Column field="entityName" header="Customer" />
        <Column field="current" header="Current" class="text-right" style="width: 120px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as AgedEntityRow).current" />
          </template>
        </Column>
        <Column field="days1_30" header="1–30 days" class="text-right" style="width: 110px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as AgedEntityRow).days1_30" />
          </template>
        </Column>
        <Column field="days31_60" header="31–60 days" class="text-right" style="width: 110px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as AgedEntityRow).days31_60" />
          </template>
        </Column>
        <Column field="days61_90" header="61–90 days" class="text-right" style="width: 110px">
          <template #body="{ data }">
            <MoneyCell :amount="(data as AgedEntityRow).days61_90" />
          </template>
        </Column>
        <Column field="days91Plus" header="91+ days" class="text-right" style="width: 110px">
          <template #body="{ data }">
            <span
              class="tabular-nums"
              :class="
                parseFloat((data as AgedEntityRow).days91Plus) > 0
                  ? 'text-rose-600 dark:text-rose-400 font-medium'
                  : ''
              "
            >
              <MoneyCell :amount="(data as AgedEntityRow).days91Plus" />
            </span>
          </template>
        </Column>
        <Column field="total" header="Total" class="text-right" style="width: 140px">
          <template #body="{ data }">
            <span class="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              <MoneyCell :amount="(data as AgedEntityRow).total" />
            </span>
          </template>
        </Column>
        <Column header="" style="width: 44px">
          <template #body="{ data }">
            <button
              class="text-surface-400 hover:text-indigo-500"
              @click="() => void router.push(`/customers/${(data as AgedEntityRow).entityId}/soa`)"
            >
              <ExternalLink class="w-3.5 h-3.5" />
            </button>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
