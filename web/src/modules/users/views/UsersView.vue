<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Column from 'primevue/column'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import EntityList from '../../../shared/ui/EntityList.vue'
import UserDrawer from '../UserDrawer.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import type { Permission, Role } from '@koosani/shared'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  createdAt: string
  updatedAt: string
  permissions?: Permission[]
}

const ROLE_OPTIONS = [
  { label: 'All roles', value: null },
  { label: 'Admin', value: 'admin' },
  { label: 'Manager', value: 'manager' },
  { label: 'Staff', value: 'staff' },
]

const ROLE_SEVERITY: Record<Role, 'danger' | 'warn' | 'secondary'> = {
  admin: 'danger',
  manager: 'warn',
  staff: 'secondary',
}

const toast = useToast()

const rows = ref<AdminUser[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const q = ref('')
const roleFilter = ref<Role | null>(null)

const selected = ref<AdminUser | null>(null)
const drawerOpen = ref(false)

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    })
    if (q.value) params.set('q', q.value)
    if (roleFilter.value) params.set('role', roleFilter.value)
    const data = await apiFetch<{ items: AdminUser[]; total: number }>(`/users?${params}`)
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

function onRoleFilterChange() {
  page.value = 1
  void load()
}

function openCreate() {
  selected.value = null
  drawerOpen.value = true
}

async function onRowClick(row: unknown) {
  const u = row as AdminUser
  try {
    selected.value = await apiFetch<AdminUser>(`/users/${u.id}`)
    drawerOpen.value = true
  } catch {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load user.',
      life: 5000,
    })
  }
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
        <h2 class="text-2xl font-semibold text-surface-900">Users</h2>
        <p class="text-surface-500 mt-0.5">Manage team members, roles, and permissions.</p>
      </div>
    </div>

    <EntityList
      :rows="rows"
      :total="total"
      :loading="loading"
      :page="page"
      :page-size="pageSize"
      entity="User"
      @page="onPage"
      @search="onSearch"
      @create="openCreate"
      @row-click="onRowClick"
    >
      <template #filters>
        <Select
          v-model="roleFilter"
          :options="ROLE_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-44"
          @change="onRoleFilterChange"
        />
      </template>

      <Column field="name" header="Name" sortable />
      <Column field="email" header="Email" />
      <Column field="role" header="Role">
        <template #body="{ data }: { data: AdminUser }">
          <Tag :value="data.role" :severity="ROLE_SEVERITY[data.role]" class="capitalize" />
        </template>
      </Column>
    </EntityList>

    <UserDrawer
      :user="selected"
      :open="drawerOpen"
      @close="drawerOpen = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>
