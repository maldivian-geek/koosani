<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import { useConfirm } from 'primevue/useconfirm'
import { ArrowLeft, Pencil, Play, Pause, PlayCircle } from '@lucide/vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface RecurrenceLine {
  id: string
  description: string
  qty: string
  unitPrice: string
}

interface RecurrenceProfile {
  id: string
  customerId: string
  customerName: string
  name: string
  frequency: string
  startDate: string
  endDate: string | null
  nextRunDate: string
  active: boolean
  autoIssue: boolean
  dueDaysAfterIssue: number | null
  notes: string | null
  lastGeneratedAt: string | null
  lines: RecurrenceLine[]
}

const router = useRouter()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const profileId = computed(() => route.params.id as string)
const profile = ref<RecurrenceProfile | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    profile.value = await apiFetch<RecurrenceProfile>(`/recurrence-profiles/${profileId.value}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/recurring')
      return
    }
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Something went wrong. Please try again.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

const toggling = ref(false)
async function toggleActive() {
  if (!profile.value) return
  toggling.value = true
  try {
    await apiFetch(`/recurrence-profiles/${profileId.value}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !profile.value.active }),
    })
    await load()
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to update.', life: 4000 })
  } finally {
    toggling.value = false
  }
}

const generating = ref(false)
function generateNow() {
  confirm.require({
    message: "Generate this cycle's invoice now, instead of waiting for the daily schedule?",
    header: 'Generate Now',
    acceptLabel: 'Generate',
    rejectLabel: 'Cancel',
    accept: async () => {
      generating.value = true
      try {
        const result = await apiFetch<{ invoiceId: string }>(
          `/recurrence-profiles/${profileId.value}/generate`,
          { method: 'POST', body: '{}' },
        )
        toast.add({
          severity: 'success',
          summary: 'Generated',
          detail: 'Invoice created.',
          life: 3000,
        })
        void router.push(`/invoices/${result.invoiceId}`)
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 422
            ? 'This profile is not due yet — nextRunDate is in the future.'
            : 'Something went wrong. Please try again.'
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 4000 })
      } finally {
        generating.value = false
      }
    },
  })
}

function frequencyLabel(f: string): string {
  return f.charAt(0).toUpperCase() + f.slice(1)
}

onMounted(() => void load())
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/recurring')">
        <ArrowLeft class="w-4 h-4" />
        Recurring Invoices
      </Button>
      <div class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ profile?.name }}
        </h2>
      </div>

      <div class="flex gap-2 flex-wrap">
        <Button
          severity="secondary"
          @click="() => void router.push(`/recurring/${profileId}/edit`)"
        >
          <Pencil class="w-4 h-4" />
          Edit
        </Button>

        <Button
          v-if="profile"
          :severity="profile.active ? 'danger' : 'success'"
          outlined
          :loading="toggling"
          @click="toggleActive"
        >
          <Pause v-if="profile.active" class="w-4 h-4" />
          <Play v-else class="w-4 h-4" />
          {{ profile.active ? 'Pause' : 'Resume' }}
        </Button>

        <Button :loading="generating" @click="generateNow">
          <PlayCircle class="w-4 h-4" />
          Generate Now
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card p-6 text-center text-surface-500">Loading…</div>

    <template v-else-if="profile">
      <div class="card p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Customer
            </p>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ profile.customerName }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Frequency
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              {{ frequencyLabel(profile.frequency) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Next Run
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="profile.nextRunDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Mode
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              {{ profile.autoIssue ? 'Auto-issue' : 'Draft only' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Started
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell :date="profile.startDate" />
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Ends
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell v-if="profile.endDate" :date="profile.endDate" />
              <span v-else>Indefinitely</span>
            </p>
          </div>
          <div>
            <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
              Last Generated
            </p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              <DateCell v-if="profile.lastGeneratedAt" :date="profile.lastGeneratedAt" />
              <span v-else>Never</span>
            </p>
          </div>
        </div>
        <div
          v-if="profile.notes"
          class="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800"
        >
          <p class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1">
            Notes
          </p>
          <p class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-line">
            {{ profile.notes }}
          </p>
        </div>
      </div>

      <div class="card overflow-hidden p-0!">
        <div class="px-6 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Template Line Items
          </h3>
        </div>
        <DataTable :value="profile.lines" :pt="{ root: { class: 'text-sm!' } }">
          <Column field="description" header="Description" />
          <Column field="qty" header="Qty" class="text-right" style="width: 100px" />
          <Column field="unitPrice" header="Unit Price" class="text-right" style="width: 130px">
            <template #body="{ data }">
              <MoneyCell :amount="(data as RecurrenceLine).unitPrice" />
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>
