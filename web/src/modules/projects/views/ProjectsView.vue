<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Column from 'primevue/column'
import EntityList from '../../../shared/ui/EntityList.vue'
import { stackPt } from '../../../shared/ui/entityListColumnPt.js'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import ProjectDrawer from '../ProjectDrawer.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

export interface Project {
  id: string
  customerId: string | null
  name: string
  description: string | null
  status: 'active' | 'completed' | 'archived'
  defaultBillableRate: string | null
  defaultGstCategory: string
}

const router = useRouter()
const toast = useToast()

const rows = ref<Project[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)

const selected = ref<Project | null>(null)
const drawerOpen = ref(false)

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    const data = await apiFetch<{ items: Project[]; total: number }>(`/projects?${params}`)
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

function openCreate() {
  selected.value = null
  drawerOpen.value = true
}

function onRowClick(row: unknown) {
  void router.push(`/projects/${(row as Project).id}`)
}

function onSaved() {
  drawerOpen.value = false
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900">Projects</h2>
      <p class="text-surface-500 mt-0.5">
        Track billable work and time — log hours against a project, then add them to a customer's
        invoice.
      </p>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="Project"
      @page="onPage"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <Column field="name" header="Name" sortable :pt="stackPt" />
      <Column header="Status" style="width: 120px" :pt="stackPt">
        <template #body="{ data }">
          <StatusTag :status="(data as Project).status" />
        </template>
      </Column>
      <Column header="Default rate" style="width: 130px" :pt="stackPt">
        <template #body="{ data }">
          {{ (data as Project).defaultBillableRate ?? '—' }}
        </template>
      </Column>
    </EntityList>

    <ProjectDrawer
      :project="selected"
      :open="drawerOpen"
      @close="drawerOpen = false"
      @saved="onSaved"
    />
  </div>
</template>
