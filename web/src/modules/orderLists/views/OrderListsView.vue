<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import DateCell from '../../../shared/ui/DateCell.vue'
import OrderListCreateDialog from '../OrderListCreateDialog.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface OrderListRow {
  id: string
  title: string
  notes: string | null
  lineCount: number
  createdAt: string
  updatedAt: string
}

const router = useRouter()
const toast = useToast()

const rows = ref<OrderListRow[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')

const dialogOpen = ref(false)

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    const data = await apiFetch<{ items: OrderListRow[]; total: number }>(`/order-lists?${params}`)
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

function openCreate() {
  dialogOpen.value = true
}

function onRowClick(row: unknown) {
  const list = row as OrderListRow
  void router.push(`/order-lists/${list.id}`)
}

function onCreated(id: string) {
  dialogOpen.value = false
  void router.push(`/order-lists/${id}`)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900">Order Lists</h2>
      <p class="text-surface-500 mt-0.5">
        Named working checklists of stock-order lines — payment and stock status tracked per row.
      </p>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Order List"
      @page="onPage"
      @search="onSearch"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <Column field="title" header="Title" sortable :pt="stackPt" />
      <Column header="Lines" style="width: 100px" :pt="stackPt">
        <template #body="{ data }">{{ (data as OrderListRow).lineCount }}</template>
      </Column>
      <Column header="Updated" style="width: 150px" :pt="stackPt">
        <template #body="{ data }">
          <DateCell :date="(data as OrderListRow).updatedAt" />
        </template>
      </Column>
    </EntityList>

    <OrderListCreateDialog v-if="dialogOpen" @close="dialogOpen = false" @created="onCreated" />
  </div>
</template>
