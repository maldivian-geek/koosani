<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'
import DatePicker from 'primevue/datepicker'
import { Pencil, Check, X } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

// Generic custom-field value viewer/editor, embedded in a document's detail
// view (Phase 33c, UPGRADE.md G-13/F-24 — see ARCHITECTURE.md §4.15). Renders
// nothing if the business hasn't defined any custom fields for this doc type.

interface CustomFieldWithValue {
  fieldDefinitionId: string
  fieldName: string
  fieldLabel: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
  sortOrder: number
  value: string | null
}

const props = defineProps<{
  docType: 'invoice' | 'estimate' | 'po' | 'bill' | 'credit_note'
  docId: string
}>()

const toast = useToast()
const fields = ref<CustomFieldWithValue[]>([])
const loading = ref(false)
const editing = ref(false)
const saving = ref(false)
const draft = ref<Record<string, string>>({})

async function load() {
  loading.value = true
  try {
    fields.value = await apiFetch<CustomFieldWithValue[]>(
      `/custom-fields/values?docType=${props.docType}&docId=${props.docId}`,
    )
  } catch {
    fields.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.docId,
  () => void load(),
)
onMounted(() => void load())

function startEdit() {
  draft.value = Object.fromEntries(fields.value.map((f) => [f.fieldDefinitionId, f.value ?? '']))
  editing.value = true
}

function formatValue(f: CustomFieldWithValue): string {
  if (f.value === null) return '—'
  if (f.fieldType === 'boolean') return f.value === 'true' ? 'Yes' : 'No'
  return f.value
}

async function save() {
  saving.value = true
  try {
    const values = fields.value.map((f) => ({
      fieldDefinitionId: f.fieldDefinitionId,
      value: draft.value[f.fieldDefinitionId]?.trim() ? draft.value[f.fieldDefinitionId]! : null,
    }))
    fields.value = await apiFetch<CustomFieldWithValue[]>('/custom-fields/values', {
      method: 'PUT',
      body: JSON.stringify({ docType: props.docType, docId: props.docId, values }),
    })
    editing.value = false
    toast.add({
      severity: 'success',
      summary: 'Saved',
      detail: 'Custom fields updated.',
      life: 3000,
    })
  } catch (err) {
    const detail =
      err instanceof ApiError && err.status === 422
        ? 'One or more values are invalid for their field type.'
        : err instanceof ApiError && err.status === 403
          ? "You don't have permission to do that."
          : 'Something went wrong. Please try again.'
    toast.add({ severity: 'error', summary: 'Error', detail, life: 5000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="!loading && fields.length > 0" class="card p-6 space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-base font-medium text-surface-700 dark:text-surface-300">Custom Fields</h3>
      <div v-if="!editing" class="flex gap-2">
        <Button size="small" severity="secondary" @click="startEdit">
          <Pencil class="w-4 h-4" />
          Edit
        </Button>
      </div>
      <div v-else class="flex gap-2">
        <Button size="small" severity="secondary" text @click="editing = false">
          <X class="w-4 h-4" />
        </Button>
        <Button size="small" :loading="saving" @click="save">
          <Check class="w-4 h-4" />
          Save
        </Button>
      </div>
    </div>

    <div v-if="!editing" class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div v-for="f in fields" :key="f.fieldDefinitionId">
        <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">{{ f.fieldLabel }}</p>
        <p class="text-sm text-surface-700 dark:text-surface-300">{{ formatValue(f) }}</p>
      </div>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="f in fields" :key="f.fieldDefinitionId" class="flex flex-col gap-1">
        <label class="text-sm font-medium">{{ f.fieldLabel }}</label>
        <Checkbox
          v-if="f.fieldType === 'boolean'"
          :model-value="draft[f.fieldDefinitionId] === 'true'"
          binary
          @update:model-value="(v) => (draft[f.fieldDefinitionId] = v ? 'true' : 'false')"
        />
        <DatePicker
          v-else-if="f.fieldType === 'date'"
          :model-value="draft[f.fieldDefinitionId] ? new Date(draft[f.fieldDefinitionId]!) : null"
          date-format="dd M yy"
          show-icon
          @update:model-value="
            (v) => {
              const d = v as Date | null
              draft[f.fieldDefinitionId] = d
                ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                : ''
            }
          "
        />
        <InputText
          v-else
          v-model="draft[f.fieldDefinitionId]"
          :inputmode="f.fieldType === 'number' ? 'decimal' : 'text'"
        />
      </div>
    </div>
  </div>
</template>
