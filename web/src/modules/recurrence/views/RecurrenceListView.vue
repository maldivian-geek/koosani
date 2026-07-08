<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import Select from 'primevue/select'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface RecurrenceProfile {
  id: string
  customerId: string
  customerName: string
  name: string
  frequency: string
  nextRunDate: string
  endDate: string | null
  active: boolean
  autoIssue: boolean
}

const router = useRouter()
const toast = useToast()

const rows = ref<RecurrenceProfile[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')
const activeFilter = ref<string | null>(null)

const activeOptions = [
  { label: 'All', value: null },
  { label: 'Active', value: 'true' },
  { label: 'Paused', value: 'false' },
]

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    if (activeFilter.value !== null) params.set('active', activeFilter.value)

    const data = await apiFetch<{ items: RecurrenceProfile[]; total: number }>(
      `/recurrence-profiles?${params}`,
    )
    rows.value = data.items
    total.value = data.total
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 })
  } finally {
    loading.value = false
  }
}

function onPage(e: { page: number; pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
  void load()
}

function onSearch(query: string) {
  q.value = query
  page.value = 1
  void load()
}

function onCreate() {
  void router.push('/recurring/new')
}

function onRowClick(row: unknown) {
  const p = row as RecurrenceProfile
  void router.push(`/recurring/${p.id}`)
}

function frequencyLabel(f: string): string {
  return f.charAt(0).toUpperCase() + f.slice(1)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          Recurring Invoices
        </h2>
        <p class="text-surface-500 dark:text-surface-400 mt-0.5">
          Profiles that automatically generate invoices on a schedule.
        </p>
      </div>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Profile"
      @page="onPage"
      @search="onSearch"
      @create="onCreate"
      @row-click="onRowClick"
    >
      <template #filters>
        <Select
          v-model="activeFilter"
          :options="activeOptions"
          option-label="label"
          option-value="value"
          placeholder="All"
          class="w-36"
          @change="
            () => {
              page = 1
              void load()
            }
          "
        />
      </template>

      <Column field="name" header="Name" :pt="stackPt" />
      <Column field="customerName" header="Customer" :pt="stackPt" />
      <Column field="frequency" header="Frequency" :pt="stackPt">
        <template #body="{ data }">
          {{ frequencyLabel((data as RecurrenceProfile).frequency) }}
        </template>
      </Column>
      <Column field="nextRunDate" header="Next Run" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as RecurrenceProfile).nextRunDate" />
        </template>
      </Column>
      <Column field="autoIssue" header="Mode" :pt="stackPt">
        <template #body="{ data }">
          <span class="text-xs text-surface-500">{{
            (data as RecurrenceProfile).autoIssue ? 'Auto-issue' : 'Draft only'
          }}</span>
        </template>
      </Column>
      <Column field="active" header="Status" :pt="stackPt">
        <template #body="{ data }">
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="
              (data as RecurrenceProfile).active
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-800'
            "
          >
            {{ (data as RecurrenceProfile).active ? 'Active' : 'Paused' }}
          </span>
        </template>
      </Column>
    </EntityList>
  </div>
</template>
