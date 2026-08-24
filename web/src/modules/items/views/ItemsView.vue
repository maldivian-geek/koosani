<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
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
  customerItemName: string | null
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
    const params = new URLSearchParams({
      active: 'true',
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    const data = await apiFetch<{ items: Item[]; total: number; page: number; pageSize: number }>(
      `/items?${params}`,
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
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900">Items</h2>
        <p class="text-surface-500 mt-0.5">Products and services in your catalogue.</p>
      </div>
    </div>

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
      <Column field="sku" header="SKU" sortable :pt="stackPt" />
      <Column field="name" header="Name" sortable :pt="stackPt" />
      <Column field="unit" header="Unit" :pt="stackPt" />
      <Column header="Category" :pt="stackPt">
        <template #body="{ data }">{{ categoryName((data as Item).categoryId) }}</template>
      </Column>
      <Column header="GST Category" :pt="stackPt">
        <template #body="{ data }">{{
          GST_LABELS[(data as Item).gstCategory] ?? (data as Item).gstCategory
        }}</template>
      </Column>
      <Column field="defaultPrice" header="Price (MVR)" :pt="stackPt" />
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
