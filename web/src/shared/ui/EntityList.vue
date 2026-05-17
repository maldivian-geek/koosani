<script setup lang="ts">
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import EmptyState from './EmptyState.vue'

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
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3 flex-wrap">
      <div class="relative">
        <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm" />
        <InputText v-model="q" placeholder="Search…" class="pl-9" @input="onSearchInput" />
      </div>
      <div class="flex-1" />
      <slot name="filters" />
      <Button
        v-if="canCreate"
        icon="pi pi-plus"
        :label="`New ${entity}`"
        @click="$emit('create')"
      />
    </div>

    <DataTable
      :value="rows"
      :loading="loading"
      :lazy="true"
      :total-records="totalRecords"
      :rows="pageSize"
      :first="first"
      size="small"
      paginator
      :rows-per-page-options="[10, 20, 50]"
      row-hover
      @page="onPage"
      @row-click="$emit('rowClick', $event.data)"
    >
      <template #empty>
        <EmptyState
          :entity="entity"
          :variant="q ? 'filtered' : 'first-time'"
          @clear-filters="clearSearch"
        />
      </template>
      <slot />
    </DataTable>
  </div>
</template>
