<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'
import { Trash2 } from '@lucide/vue'
import { OrderLinesImport, type OrderLineCreate } from '@koosani/shared'
import { apiFetch, ApiError } from '../../lib/apiFetch.js'
import type { OrderListLine } from './views/OrderListDetailView.vue'

// Paste-from-spreadsheet import with a mandatory review step (SECURITY.md
// §13.13): paste → server parses to drafts → user edits/removes rows here →
// confirm creates the batch via /lines/bulk.

const props = defineProps<{ orderListId: string }>()
const emit = defineEmits<{ close: []; imported: [OrderListLine[]] }>()

type DraftRow = OrderLineCreate & { key: number }

const toast = useToast()
const visible = ref(true)
const step = ref<'paste' | 'review'>('paste')
const loading = ref(false)
const error = ref('')
const text = ref('')
const drafts = ref<DraftRow[]>([])
const skipped = ref(0)

const canImport = computed(() => drafts.value.length > 0 && drafts.value.length <= 500)

async function parse() {
  error.value = ''
  if (!text.value.trim()) {
    error.value = 'Paste some rows first.'
    return
  }
  loading.value = true
  try {
    const result = await apiFetch<{ lines: OrderLineCreate[]; skipped: number }>(
      `/order-lists/${props.orderListId}/lines/parse`,
      { method: 'POST', body: JSON.stringify({ text: text.value }) },
    )
    drafts.value = result.lines.map((line, i) => ({ ...line, key: i }))
    skipped.value = result.skipped
    if (drafts.value.length === 0) {
      error.value =
        'No rows could be read. Expected columns: Item, Qty, Unit, Note, Additional note.'
      return
    }
    step.value = 'review'
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}

function removeDraft(key: number) {
  drafts.value = drafts.value.filter((d) => d.key !== key)
}

async function confirmImport() {
  error.value = ''
  const payload = {
    lines: drafts.value.map((d) => ({
      itemName: d.itemName,
      qty: d.qty || '1',
      uom: d.uom || 'Each',
      note: d.note || undefined,
      additionalNote: d.additionalNote || undefined,
    })),
  }
  const parsed = OrderLinesImport.safeParse(payload)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Some rows are invalid.'
    return
  }

  loading.value = true
  try {
    const result = await apiFetch<{ lines: OrderListLine[] }>(
      `/order-lists/${props.orderListId}/lines/bulk`,
      { method: 'POST', body: JSON.stringify(parsed.data) },
    )
    toast.add({
      severity: 'success',
      summary: 'Imported',
      detail: `${result.lines.length} lines added.`,
      life: 4000,
    })
    emit('imported', result.lines)
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 403
        ? "You don't have permission to do that."
        : 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Import lines"
    modal
    :style="{ width: step === 'paste' ? '40rem' : '64rem' }"
    :closable="false"
    :pt="{ content: { class: 'space-y-4 pt-2!' } }"
    @after-hide="emit('close')"
  >
    <template v-if="step === 'paste'">
      <p class="text-sm text-surface-500">
        Paste rows copied from Excel or a CSV. Expected columns, in order:
        <span class="font-medium text-surface-700">Item, Qty, Unit, Note, Additional note</span>
        — extra columns are ignored, and a header row is skipped automatically.
      </p>
      <Textarea
        v-model="text"
        rows="12"
        class="w-full resize-none font-mono text-xs"
        autofocus
        placeholder="TS BISCOLATA MOOD 135 GM - TIN&#9;24&#9;Each&#10;TS CHICKEN 900G&#9;54&#9;Each&#9;&#9;20"
      />
    </template>

    <template v-else>
      <p class="text-sm text-surface-500">
        Review before importing — edit any cell or remove rows.
        <span v-if="skipped > 0">{{ skipped }} row(s) could not be read and were skipped.</span>
      </p>
      <DataTable :value="drafts" data-key="key" scrollable scroll-height="24rem" size="small">
        <Column header="Item">
          <template #body="{ data }">
            <InputText v-model="(data as DraftRow).itemName" class="w-full" size="small" />
          </template>
        </Column>
        <Column header="Qty" style="width: 7rem">
          <template #body="{ data }">
            <InputText
              v-model="(data as DraftRow).qty"
              inputmode="decimal"
              class="w-full"
              size="small"
            />
          </template>
        </Column>
        <Column header="Unit" style="width: 8rem">
          <template #body="{ data }">
            <InputText v-model="(data as DraftRow).uom" class="w-full" size="small" />
          </template>
        </Column>
        <Column header="Note" style="width: 12rem">
          <template #body="{ data }">
            <InputText v-model="(data as DraftRow).note" class="w-full" size="small" />
          </template>
        </Column>
        <Column header="Additional note" style="width: 12rem">
          <template #body="{ data }">
            <InputText v-model="(data as DraftRow).additionalNote" class="w-full" size="small" />
          </template>
        </Column>
        <Column style="width: 3rem">
          <template #body="{ data }">
            <button
              class="text-surface-400 hover:text-red-600 transition-colors"
              @click="removeDraft((data as DraftRow).key)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </template>
        </Column>
      </DataTable>
    </template>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" @click="emit('close')" />
        <Button
          v-if="step === 'review'"
          label="Back"
          severity="secondary"
          :disabled="loading"
          @click="step = 'paste'"
        />
        <Button v-if="step === 'paste'" label="Preview" :loading="loading" @click="parse" />
        <Button
          v-else
          :label="`Import ${drafts.length} line${drafts.length === 1 ? '' : 's'}`"
          :loading="loading"
          :disabled="!canImport"
          @click="confirmImport"
        />
      </div>
    </template>
  </Dialog>
</template>
