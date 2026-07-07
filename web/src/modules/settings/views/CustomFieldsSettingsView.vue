<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Select from 'primevue/select'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { useConfirm } from 'primevue/useconfirm'
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'
import { CustomFieldDefinitionCreate } from '@koosani/shared'

interface Definition {
  id: string
  docType: string
  fieldName: string
  fieldLabel: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
  sortOrder: number
}

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const DOC_TYPE_OPTIONS = [
  { label: 'Invoices', value: 'invoice' },
  { label: 'Estimates', value: 'estimate' },
  { label: 'Purchase Orders', value: 'po' },
  { label: 'Bills', value: 'bill' },
  { label: 'Credit Notes', value: 'credit_note' },
]

const FIELD_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'Yes/No', value: 'boolean' },
]

const docType = ref('invoice')
const rows = ref<Definition[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    rows.value = await apiFetch<Definition[]>(`/custom-fields/definitions?docType=${docType.value}`)
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

function onDocTypeChange() {
  void load()
}

function fieldTypeLabel(t: string): string {
  return FIELD_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t
}

// ─── Create/edit dialog ───────────────────────────────────────────────────────
const dialogOpen = ref(false)
const editing = ref<Definition | null>(null)
const fieldName = ref('')
const fieldLabel = ref('')
const fieldType = ref('text')
const saving = ref(false)
const errors = ref<Record<string, string>>({})

function openCreate() {
  editing.value = null
  fieldName.value = ''
  fieldLabel.value = ''
  fieldType.value = 'text'
  errors.value = {}
  dialogOpen.value = true
}

function openEdit(def: Definition) {
  editing.value = def
  fieldName.value = def.fieldName
  fieldLabel.value = def.fieldLabel
  fieldType.value = def.fieldType
  errors.value = {}
  dialogOpen.value = true
}

async function submit() {
  errors.value = {}
  saving.value = true
  try {
    if (editing.value) {
      await apiFetch(`/custom-fields/definitions/${editing.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fieldLabel: fieldLabel.value }),
      })
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Field updated.', life: 3000 })
    } else {
      const payload = {
        docType: docType.value as CustomFieldDefinitionCreate['docType'],
        fieldName: fieldName.value,
        fieldLabel: fieldLabel.value,
        fieldType: fieldType.value as CustomFieldDefinitionCreate['fieldType'],
      }
      const result = CustomFieldDefinitionCreate.safeParse(payload)
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string
          if (!errors.value[field]) errors.value[field] = issue.message
        }
        saving.value = false
        return
      }
      await apiFetch('/custom-fields/definitions', {
        method: 'POST',
        body: JSON.stringify(result.data),
      })
      toast.add({ severity: 'success', summary: 'Created', detail: 'Field created.', life: 3000 })
    }
    dialogOpen.value = false
    await load()
  } catch (err) {
    const detail =
      err instanceof ApiError && err.status === 422
        ? 'That field name is already used for this document type.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail, life: 5000 })
  } finally {
    saving.value = false
  }
}

function remove(def: Definition) {
  confirm.require({
    message: `Delete the "${def.fieldLabel}" field? Any values already set on documents will be removed too.`,
    header: 'Delete Field',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await apiFetch(`/custom-fields/definitions/${def.id}`, { method: 'DELETE' })
        toast.add({ severity: 'info', summary: 'Deleted', detail: 'Field deleted.', life: 3000 })
        await load()
      } catch {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Something went wrong.',
          life: 5000,
        })
      }
    },
  })
}

onMounted(() => void load())
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4">
      <Button severity="secondary" text @click="() => void router.push('/settings')">
        <ArrowLeft class="w-4 h-4" />
        Settings
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Custom Fields</h2>
        <p class="text-surface-500 text-sm mt-0.5">
          Define extra fields per document type. Values are shown on that document's PDF.
        </p>
      </div>
    </div>

    <div class="card p-6 space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <Select
          v-model="docType"
          :options="DOC_TYPE_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-56"
          @change="onDocTypeChange"
        />
        <Button @click="openCreate">
          <Plus class="w-4 h-4" />
          New Field
        </Button>
      </div>

      <DataTable :value="rows" :loading="loading" :pt="{ root: { class: 'text-sm!' } }">
        <template #empty>No custom fields defined for this document type yet.</template>
        <Column field="fieldLabel" header="Label" />
        <Column field="fieldName" header="Key" style="width: 180px">
          <template #body="{ data }">
            <span class="font-mono text-xs">{{ (data as Definition).fieldName }}</span>
          </template>
        </Column>
        <Column header="Type" style="width: 100px">
          <template #body="{ data }">{{ fieldTypeLabel((data as Definition).fieldType) }}</template>
        </Column>
        <Column header="" style="width: 90px">
          <template #body="{ data }">
            <div class="flex gap-1">
              <Button severity="secondary" text size="small" @click="openEdit(data as Definition)">
                <Pencil class="w-4 h-4" />
              </Button>
              <Button severity="danger" text size="small" @click="remove(data as Definition)">
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog
      v-model:visible="dialogOpen"
      :header="editing ? 'Edit Field' : 'New Field'"
      modal
      :style="{ width: '26rem' }"
    >
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Label</label>
          <InputText v-model="fieldLabel" placeholder="e.g. PO Reference" fluid />
          <small v-if="errors.fieldLabel" class="text-red-500">{{ errors.fieldLabel }}</small>
        </div>
        <div v-if="!editing" class="flex flex-col gap-1">
          <label class="text-sm font-medium">Key</label>
          <InputText v-model="fieldName" placeholder="e.g. po_reference" fluid />
          <small class="text-surface-400"
            >Lowercase letters, numbers, underscores. Can't be changed later.</small
          >
          <small v-if="errors.fieldName" class="text-red-500">{{ errors.fieldName }}</small>
        </div>
        <div v-if="!editing" class="flex flex-col gap-1">
          <label class="text-sm font-medium">Type</label>
          <Select
            v-model="fieldType"
            :options="FIELD_TYPE_OPTIONS"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="dialogOpen = false" />
        <Button label="Save" :loading="saving" @click="submit" />
      </template>
    </Dialog>
  </div>
</template>
