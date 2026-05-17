<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import ItemDrawer from '../ItemDrawer.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface Category {
  id: string
  name: string
  parentId: string | null
}

export interface Item {
  id: string
  sku: string
  name: string
  unit: string
  categoryId: string | null
  gstCategory: string
  defaultPrice: string | null
  defaultCost: string | null
  reorderPoint: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

const toast = useToast()

const rows = ref<Item[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')

const categories = ref<Category[]>([])
const selected = ref<Item | null>(null)
const drawerOpen = ref(false)

async function loadCategories() {
  try {
    categories.value = await apiFetch<Category[]>('/item-categories')
  } catch {
    // non-fatal; category names just won't display
  }
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({ active: 'true' })
    if (q.value) params.set('q', q.value)
    const data = await apiFetch<Item[]>(`/items?${params}`)
    rows.value = data
    total.value = data.length
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

function categoryName(id: string | null): string {
  if (!id) return '—'
  return categories.value.find((c) => c.id === id)?.name ?? '—'
}

const GST_LABELS: Record<string, string> = {
  general_8: 'General 8%',
  tourism_16: 'Tourism 16%',
  tourism_17: 'Tourism 17%',
  zero: 'Zero-rated',
  exempt: 'Exempt',
}

function onPage(e: { page: number; pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
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
  selected.value = row as Item
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

onMounted(() => {
  void loadCategories()
  void load()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-6">Items</h1>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Item"
      @page="onPage"
      @search="onSearch"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <Column field="sku" header="SKU" sortable />
      <Column field="name" header="Name" sortable />
      <Column field="unit" header="Unit" />
      <Column header="Category">
        <template #body="{ data }">{{ categoryName((data as Item).categoryId) }}</template>
      </Column>
      <Column header="GST Category">
        <template #body="{ data }">{{
          GST_LABELS[(data as Item).gstCategory] ?? (data as Item).gstCategory
        }}</template>
      </Column>
      <Column field="defaultPrice" header="Price (MVR)" />
    </EntityList>

    <ItemDrawer
      :item="selected"
      :open="drawerOpen"
      :categories="categories"
      @close="drawerOpen = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>
