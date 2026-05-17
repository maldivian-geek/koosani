<script setup lang="ts">
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { Search, Plus } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    rows: unknown[]
    total?: number
    loading?: boolean
    page?: number
    pageSize?: number
    entity?: string
    canCreate?: boolean
  }>(),
  {
    total: undefined,
    loading: false,
    page: 1,
    pageSize: 20,
    entity: 'records',
    canCreate: true,
  },
)

const emit = defineEmits<{
  page: [{ page: number; pageSize: number }]
  search: [string]
  create: []
  rowClick: [unknown]
}>()

const q = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => emit('search', q.value), 300)
}

function clearSearch() {
  q.value = ''
  emit('search', '')
}

const first = computed(() => ((props.page ?? 1) - 1) * (props.pageSize ?? 20))
const totalRecords = computed(() => props.total ?? props.rows.length)

function onPage(event: { page: number; rows: number }) {
  emit('page', { page: event.page + 1, pageSize: event.rows })
}
</script>

<template>
  <div class="space-y-4">
    <!-- filters row -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative">
        <Search
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none"
        />
        <InputText v-model="q" placeholder="Search…" class="pl-9 w-72" @input="onSearchInput" />
      </div>
      <Button v-if="q" label="Reset" severity="secondary" text @click="clearSearch" />
      <slot name="filters" />
      <span class="ml-auto text-xs text-surface-400">{{ totalRecords }} {{ entity }}s</span>
      <Button v-if="canCreate" @click="$emit('create')">
        <Plus class="w-4 h-4" />
        New {{ entity }}
      </Button>
    </div>

    <!-- table card -->
    <div class="card overflow-hidden p-0!">
      <DataTable
        :value="rows"
        :loading="loading"
        :lazy="true"
        :total-records="totalRecords"
        :rows="pageSize"
        :first="first"
        striped-rows
        scrollable
        paginator
        :rows-per-page-options="[10, 20, 50, 100]"
        paginator-template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
        removable-sort
        row-hover
        :pt="{
          root: { class: 'text-sm!' },
          paginator: { class: 'border-t! border-surface-100! px-4! py-3!' },
        }"
        @page="onPage"
        @row-click="$emit('rowClick', $event.data)"
      >
        <template #empty>
          <div class="text-center py-12 text-surface-400 text-sm">
            {{ q ? 'No results for your search.' : `No ${entity}s yet.` }}
          </div>
        </template>
        <slot />
      </DataTable>
    </div>
  </div>
</template>
