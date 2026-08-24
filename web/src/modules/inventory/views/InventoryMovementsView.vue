<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import AutoComplete from 'primevue/autocomplete'
import { ArrowLeft } from '@lucide/vue'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface Movement {
  id: string
  itemId: string
  itemSku: string
  itemName: string
  qty: string
  source: string
  sourceId: string | null
  reason: string | null
  movedAt: string
}

interface ItemOption {
  id: string
  name: string
  sku: string
}

const router = useRouter()
const toast = useToast()

const rows = ref<Movement[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)

const item = ref<ItemOption | null>(null)
const itemSuggestions = ref<ItemOption[]>([])

async function searchItems(event: { query: string }) {
  try {
    const params = new URLSearchParams({ q: event.query, active: 'true' })
    const data = await apiFetch<ItemOption[] | { items: ItemOption[] }>(`/items?${params}`)
    itemSuggestions.value = Array.isArray(data) ? data : data.items
  } catch {
    itemSuggestions.value = []
  }
}

function onItemFilterChange() {
  page.value = 1
  void load()
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (item.value) params.set('itemId', item.value.id)
    const data = await apiFetch<{ items: Movement[]; total: number }>(
      `/inventory/movements?${params}`,
    )
    rows.value = data.items
    total.value = data.total
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

function onPage(e: { page: number; pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
  void load()
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/inventory')">
        <ArrowLeft class="w-4 h-4" />
        Inventory
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900">Movement Ledger</h2>
        <p class="text-surface-500 mt-0.5 text-sm">Append-only history of every stock change.</p>
      </div>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Movement"
      :can-create="false"
      @page="onPage"
    >
      <template #filters>
        <AutoComplete
          v-model="item"
          :suggestions="itemSuggestions"
          option-label="name"
          placeholder="Filter by item…"
          @complete="searchItems"
          @option-select="onItemFilterChange"
          @clear="onItemFilterChange"
        />
      </template>
      <Column field="movedAt" header="Date" style="width: 160px" :pt="stackPt">
        <template #body="{ data }"><DateCell :date="(data as Movement).movedAt" /></template>
      </Column>
      <Column header="Item" style="width: 220px" :pt="stackPt">
        <template #body="{ data }">
          {{ (data as Movement).itemName }}
          <span class="text-surface-400 text-xs">({{ (data as Movement).itemSku }})</span>
        </template>
      </Column>
      <Column header="Qty" class="text-right" style="width: 100px" :pt="stackPt">
        <template #body="{ data }">
          <span
            :class="
              parseFloat((data as Movement).qty) < 0
                ? 'text-red-500'
                : 'text-green-600 dark:text-green-400'
            "
          >
            {{ (data as Movement).qty }}
          </span>
        </template>
      </Column>
      <Column header="Source" style="width: 130px" :pt="stackPt">
        <template #body="{ data }">{{ sourceLabel((data as Movement).source) }}</template>
      </Column>
      <Column field="reason" header="Reason" :pt="stackPt" />
    </EntityList>
  </div>
</template>
