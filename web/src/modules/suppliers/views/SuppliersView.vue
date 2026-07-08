<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import SupplierDrawer from '../SupplierDrawer.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface Supplier {
  id: string
  name: string
  tin: string | null
  email: string | null
  phone: string | null
  address: string | null
  paymentTermsDays: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

const toast = useToast()

const rows = ref<Supplier[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')

const selected = ref<Supplier | null>(null)
const drawerOpen = ref(false)

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      active: 'true',
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    const data = await apiFetch<{
      items: Supplier[]
      total: number
      page: number
      pageSize: number
    }>(`/suppliers?${params}`)
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
  selected.value = null
  drawerOpen.value = true
}

function onRowClick(row: unknown) {
  selected.value = row as Supplier
  drawerOpen.value = true
}

function onSaved() {
  drawerOpen.value = false
  void load()
}

function onDeleted() {
  drawerOpen.value = false
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900">Suppliers</h2>
        <p class="text-surface-500 mt-0.5">Manage your suppliers and vendors.</p>
      </div>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Supplier"
      @page="onPage"
      @search="onSearch"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <Column field="name" header="Name" sortable :pt="stackPt" />
      <Column field="tin" header="TIN" :pt="stackPt" />
      <Column field="email" header="Email" :pt="stackPt" />
      <Column field="phone" header="Phone" :pt="stackPt" />
      <Column field="paymentTermsDays" header="Terms (days)" :pt="stackPt" />
    </EntityList>

    <SupplierDrawer
      :supplier="selected"
      :open="drawerOpen"
      @close="drawerOpen = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>
