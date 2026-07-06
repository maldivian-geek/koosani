<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import DatePicker from 'primevue/datepicker'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface AuditRow {
  id: string
  action: string
  entityType: string
  entityId: string
  userId: string | null
  ip: string
  beforeJson: unknown
  afterJson: unknown
  at: string
}

const toast = useToast()

const rows = ref<AuditRow[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(50)

const entityType = ref('')
const from = ref<Date | null>(null)
const to = ref<Date | null>(null)

const detailOpen = ref(false)
const detailRow = ref<AuditRow | null>(null)

function fmtDate(d: Date | null): string | undefined {
  if (!d) return undefined
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (entityType.value) params.set('entityType', entityType.value)
    const fromStr = fmtDate(from.value)
    const toStr = fmtDate(to.value)
    if (fromStr) params.set('from', fromStr)
    if (toStr) params.set('to', toStr)
    const data = await apiFetch<{ items: AuditRow[]; total: number }>(`/audit?${params}`)
    rows.value = data.items
    total.value = data.total
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to view the audit log."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    loading.value = false
  }
}

function onPage(e: { page: number; rows: number }) {
  page.value = e.page + 1
  pageSize.value = e.rows
  void load()
}

function onFilterChange() {
  page.value = 1
  void load()
}

function openDetail(row: AuditRow) {
  detailRow.value = row
  detailOpen.value = true
}

function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900">Audit Log</h2>
      <p class="text-surface-500 mt-0.5">
        Every financial mutation, append-only (SECURITY.md §13.3).
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <InputText
        v-model="entityType"
        placeholder="Entity type (e.g. invoice)"
        class="w-56"
        @change="onFilterChange"
      />
      <DatePicker
        v-model="from"
        placeholder="From"
        date-format="dd M yy"
        show-icon
        class="w-40"
        @update:model-value="onFilterChange"
      />
      <DatePicker
        v-model="to"
        placeholder="To"
        date-format="dd M yy"
        show-icon
        class="w-40"
        @update:model-value="onFilterChange"
      />
      <span class="ml-auto text-xs text-surface-400">{{ total }} entries</span>
    </div>

    <div class="card overflow-hidden p-0!">
      <DataTable
        :value="rows"
        :loading="loading"
        lazy
        :rows="pageSize"
        :total-records="total"
        :rows-per-page-options="[25, 50, 100]"
        paginator
        paginator-template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
        striped-rows
        scrollable
        row-hover
        :pt="{
          root: { class: 'text-sm!' },
          paginator: { class: 'border-t! border-surface-100! px-4! py-3!' },
        }"
        @page="onPage"
        @row-click="openDetail($event.data)"
      >
        <template #empty>
          <div class="text-center py-12 text-surface-400 text-sm">No audit entries found.</div>
        </template>
        <Column header="Date">
          <template #body="{ data }: { data: AuditRow }">{{ fmtAt(data.at) }}</template>
        </Column>
        <Column field="action" header="Action" />
        <Column field="entityType" header="Entity" />
        <Column field="entityId" header="Entity ID" />
        <Column field="ip" header="IP" />
      </DataTable>
    </div>

    <Dialog
      v-model:visible="detailOpen"
      header="Audit entry"
      modal
      :style="{ width: '42rem' }"
      :closable="false"
    >
      <div v-if="detailRow" class="space-y-4">
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><span class="text-surface-500">Action:</span> {{ detailRow.action }}</div>
          <div><span class="text-surface-500">Entity:</span> {{ detailRow.entityType }}</div>
          <div><span class="text-surface-500">Entity ID:</span> {{ detailRow.entityId }}</div>
          <div><span class="text-surface-500">IP:</span> {{ detailRow.ip }}</div>
        </div>
        <div>
          <p class="text-xs font-medium text-surface-500 mb-1">Before</p>
          <pre class="text-xs bg-surface-50 dark:bg-surface-800 rounded-lg p-3 overflow-x-auto">{{
            JSON.stringify(detailRow.beforeJson, null, 2)
          }}</pre>
        </div>
        <div>
          <p class="text-xs font-medium text-surface-500 mb-1">After</p>
          <pre class="text-xs bg-surface-50 dark:bg-surface-800 rounded-lg p-3 overflow-x-auto">{{
            JSON.stringify(detailRow.afterJson, null, 2)
          }}</pre>
        </div>
      </div>
      <template #footer>
        <Button label="Close" severity="secondary" @click="detailOpen = false" />
      </template>
    </Dialog>
  </div>
</template>
