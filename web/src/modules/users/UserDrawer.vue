<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { UserCreate, UserPatch } from '@koosani/shared'
import type { Permission, PermissionResource, Role } from '@koosani/shared'
import type { AdminUser } from './views/UsersView.vue'

const props = defineProps<{
  user: AdminUser | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: []
  deleted: []
}>()

const toast = useToast()
const confirm = useConfirm()

const ROLE_OPTIONS: Array<{ label: string; value: Role }> = [
  { label: 'Admin', value: 'admin' },
  { label: 'Manager', value: 'manager' },
  { label: 'Staff', value: 'staff' },
]

// Matches shared/src/primitives.ts PermissionResource, minus 'gst' rate/period
// admin actions which are role-gated (requireRole), not permission-gated.
const RESOURCE_ROWS: Array<{ resource: PermissionResource; label: string }> = [
  { resource: 'customers', label: 'Customers' },
  { resource: 'suppliers', label: 'Suppliers' },
  { resource: 'items', label: 'Items' },
  { resource: 'inventory', label: 'Inventory' },
  { resource: 'invoices', label: 'Invoices & Credit Notes' },
  { resource: 'estimates', label: 'Estimates' },
  { resource: 'recurring', label: 'Recurring Invoices' },
  { resource: 'bills', label: 'Bills' },
  { resource: 'expenses', label: 'Expenses' },
  { resource: 'projects', label: 'Projects & Time Tracking' },
  { resource: 'po', label: 'Purchase Orders' },
  { resource: 'gst', label: 'GST' },
  { resource: 'reports', label: 'Reports' },
]

interface FormState {
  email: string
  name: string
  role: Role
}

const blank = (): FormState => ({ email: '', name: '', role: 'staff' })

const form = ref<FormState>(blank())
const errors = ref<Partial<Record<keyof FormState, string>>>({})
const grants = ref<Set<string>>(new Set())
const saving = ref(false)
const deleting = ref(false)

function grantKey(resource: PermissionResource, action: string): string {
  return `${resource}:${action}`
}

function isGranted(resource: PermissionResource, action: string): boolean {
  return grants.value.has(grantKey(resource, action))
}

function toggleGrant(resource: PermissionResource, action: string): void {
  const key = grantKey(resource, action)
  if (grants.value.has(key)) grants.value.delete(key)
  else grants.value.add(key)
}

const grantsAsPermissions = computed<Permission[]>(() =>
  Array.from(grants.value).map((key) => {
    const [resource, action] = key.split(':') as [PermissionResource, Permission['action']]
    return { resource, action }
  }),
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    errors.value = {}
    grants.value = new Set()
    if (props.user) {
      form.value = { email: props.user.email, name: props.user.name, role: props.user.role }
      for (const p of props.user.permissions ?? []) {
        grants.value.add(grantKey(p.resource, p.action))
      }
    } else {
      form.value = blank()
    }
  },
)

async function onSave() {
  errors.value = {}
  const isEdit = !!props.user

  if (isEdit) {
    const payload = { role: form.value.role, permissions: grantsAsPermissions.value }
    const result = UserPatch.safeParse(payload)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FormState
        if (!errors.value[field]) errors.value[field] = issue.message
      }
      return
    }
    saving.value = true
    try {
      await apiFetch(`/users/${props.user!.id}`, {
        method: 'PATCH',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'User updated.', life: 3000 })
      emit('saved')
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        life: 5000,
      })
    } finally {
      saving.value = false
    }
    return
  }

  const payload = {
    email: form.value.email,
    name: form.value.name,
    role: form.value.role,
    permissions: grantsAsPermissions.value,
  }
  const result = UserCreate.safeParse(payload)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FormState
      if (!errors.value[field]) errors.value[field] = issue.message
    }
    return
  }

  saving.value = true
  try {
    await apiFetch('/users', { method: 'POST', body: JSON.stringify(result.data) })
    toast.add({
      severity: 'success',
      summary: 'Invited',
      detail: `Invite sent to ${form.value.email}.`,
      life: 3000,
    })
    emit('saved')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}

function onDelete() {
  if (!props.user) return
  const name = props.user.name
  confirm.require({
    message: `Delete "${name}"? This cannot be undone. Their sessions will be revoked immediately.`,
    header: 'Delete User',
    icon: 'pi pi-trash',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        await apiFetch(`/users/${props.user!.id}`, { method: 'DELETE' })
        toast.add({
          severity: 'success',
          summary: 'Deleted',
          detail: `${name} deleted.`,
          life: 3000,
        })
        emit('deleted')
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
          life: 5000,
        })
      } finally {
        deleting.value = false
      }
    },
  })
}
</script>

<template>
  <Drawer
    :visible="open"
    position="right"
    :style="{ width: '480px' }"
    :header="user ? 'Edit User' : 'Invite User'"
    @update:visible="
      (v) => {
        if (!v) $emit('close')
      }
    "
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Email *</label>
        <InputText
          v-model="form.email"
          type="email"
          :disabled="!!user"
          :invalid="!!errors.email"
          fluid
        />
        <small v-if="errors.email" class="text-red-500">{{ errors.email }}</small>
        <small v-if="!user" class="text-surface-500">An invite link will be emailed here.</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Name *</label>
        <InputText v-model="form.name" :disabled="!!user" :invalid="!!errors.name" fluid />
        <small v-if="errors.name" class="text-red-500">{{ errors.name }}</small>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-medium text-sm">Role *</label>
        <Select
          v-model="form.role"
          :options="ROLE_OPTIONS"
          option-label="label"
          option-value="value"
          fluid
        />
        <small v-if="errors.role" class="text-red-500">{{ errors.role }}</small>
      </div>

      <div class="flex flex-col gap-2">
        <label class="font-medium text-sm">Explicit permission grants</label>
        <p class="text-xs text-surface-500">
          Admins and managers already have broad access by default (SECURITY.md §Authorization
          Model). Grants here only matter for staff, and for report exports (which always require an
          explicit grant).
        </p>
        <div class="card p-0! overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-100 dark:border-surface-800">
                <th class="text-left font-medium text-surface-600 px-3 py-2">Resource</th>
                <th class="font-medium text-surface-600 px-2 py-2 w-16">Add</th>
                <th class="font-medium text-surface-600 px-2 py-2 w-16">Edit</th>
                <th class="font-medium text-surface-600 px-2 py-2 w-16">Delete</th>
                <th class="font-medium text-surface-600 px-2 py-2 w-16">Export</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in RESOURCE_ROWS"
                :key="row.resource"
                class="border-b border-surface-50 dark:border-surface-800 last:border-0"
              >
                <td class="px-3 py-1.5 text-surface-700">{{ row.label }}</td>
                <td class="text-center px-2 py-1.5">
                  <Checkbox
                    :model-value="isGranted(row.resource, 'add')"
                    binary
                    @update:model-value="toggleGrant(row.resource, 'add')"
                  />
                </td>
                <td class="text-center px-2 py-1.5">
                  <Checkbox
                    :model-value="isGranted(row.resource, 'edit')"
                    binary
                    @update:model-value="toggleGrant(row.resource, 'edit')"
                  />
                </td>
                <td class="text-center px-2 py-1.5">
                  <Checkbox
                    :model-value="isGranted(row.resource, 'delete')"
                    binary
                    @update:model-value="toggleGrant(row.resource, 'delete')"
                  />
                </td>
                <td class="text-center px-2 py-1.5">
                  <Checkbox
                    v-if="row.resource === 'reports'"
                    :model-value="isGranted(row.resource, 'export')"
                    binary
                    @update:model-value="toggleGrant(row.resource, 'export')"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </form>

    <template #footer>
      <div class="flex items-center gap-2">
        <Button
          v-if="user"
          icon="pi pi-trash"
          severity="danger"
          text
          :loading="deleting"
          aria-label="Delete user"
          @click="onDelete"
        />
        <div class="flex-1" />
        <Button label="Cancel" severity="secondary" text @click="$emit('close')" />
        <Button :label="user ? 'Save' : 'Send invite'" :loading="saving" @click="onSave" />
      </div>
    </template>
  </Drawer>
</template>
