<script setup lang="ts">
import { ref, computed, useSlots } from 'vue'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Button from 'primevue/button'
import { Search, Plus } from '@lucide/vue'

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

// Opt-in mobile card rendering (DESIGN.md §11): when a view provides a
// #mobileCard slot, the DataTable (and its paginator) hide below `md` in
// favor of purpose-built tappable cards + a simple Prev/Next pager. Views
// without the slot keep the labeled stacked-table fallback unchanged —
// designed cards beat a collapsed table for entities with only a few fields,
// while wide entities still benefit from the stacked fallback.
const slots = useSlots()
const hasMobileCards = computed(() => !!slots['mobileCard'])
const lastPage = computed(() => Math.max(1, Math.ceil(totalRecords.value / (props.pageSize ?? 20))))

function goToPage(target: number) {
  emit('page', { page: target, pageSize: props.pageSize ?? 20 })
}
</script>

<template>
  <div class="space-y-4">
    <!-- filters row -->
    <div class="flex flex-wrap items-center gap-3">
      <IconField>
        <InputIcon>
          <Search class="w-4 h-4 text-surface-400" />
        </InputIcon>
        <InputText v-model="q" placeholder="Search…" class="w-72" @input="onSearchInput" />
      </IconField>
      <Button v-if="q" label="Reset" severity="secondary" text @click="clearSearch" />
      <slot name="filters" />
      <span class="ml-auto text-xs text-surface-400">{{ totalRecords }} {{ entity }}s</span>
      <Button v-if="canCreate" class="w-full md:w-auto" @click="$emit('create')">
        <Plus class="w-4 h-4" />
        New {{ entity }}
      </Button>
    </div>

    <!-- table card -->
    <div class="card overflow-hidden p-0!" :class="hasMobileCards ? 'hidden md:block' : ''">
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
          thead: { class: 'hidden! md:table-header-group!' },
          tbody: { class: 'block! md:table-row-group!' },
          bodyRow: {
            class:
              'flex! flex-col gap-1 mb-3 p-3 border border-surface-200 dark:border-surface-700 rounded-lg md:table-row! md:flex-none md:gap-0 md:mb-0 md:p-0 md:border-0 md:rounded-none',
          },
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

    <!-- mobile card list (only when the view opts in with #mobileCard) -->
    <div v-if="hasMobileCards" class="md:hidden space-y-2">
      <div v-if="loading" class="card p-8 text-center text-sm text-surface-400">Loading…</div>
      <div v-else-if="rows.length === 0" class="card p-8 text-center text-sm text-surface-400">
        {{ q ? 'No results for your search.' : `No ${entity}s yet.` }}
      </div>
      <template v-else>
        <button
          v-for="(row, i) in rows"
          :key="i"
          type="button"
          class="card w-full text-left p-4 active:bg-surface-100 dark:active:bg-surface-800 transition-colors"
          @click="$emit('rowClick', row)"
        >
          <slot name="mobileCard" :row="row" />
        </button>
      </template>
      <div v-if="totalRecords > (pageSize ?? 20)" class="flex items-center justify-between pt-1">
        <Button
          label="Previous"
          severity="secondary"
          size="small"
          :disabled="(page ?? 1) <= 1"
          @click="goToPage((page ?? 1) - 1)"
        />
        <span class="text-xs text-surface-400">Page {{ page }} of {{ lastPage }}</span>
        <Button
          label="Next"
          severity="secondary"
          size="small"
          :disabled="(page ?? 1) >= lastPage"
          @click="goToPage((page ?? 1) + 1)"
        />
      </div>
    </div>
  </div>
</template>
