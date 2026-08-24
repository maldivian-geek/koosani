<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import { ArrowLeft, Plus } from '@lucide/vue'
import StatusTag from '../../../shared/ui/StatusTag.vue'
import MoneyCell from '../../../shared/ui/MoneyCell.vue'
import DateCell from '../../../shared/ui/DateCell.vue'
import { apiFetch, ApiError } from '../../../lib/apiFetch.js'
import { useToast } from 'primevue/usetoast'

interface Task {
  id: string
  name: string
  description: string | null
  status: string
  billable: boolean
  billableRate: string | null
}

interface ProjectDetail {
  id: string
  customerId: string | null
  name: string
  description: string | null
  status: string
  defaultBillableRate: string | null
  defaultGstCategory: string
  tasks: Task[]
}

interface TimeEntry {
  id: string
  taskId: string | null
  entryDate: string
  hours: string
  description: string | null
  billable: boolean
  billableRate: string | null
  invoicedAt: string | null
}

const route = useRoute()
const router = useRouter()
const toast = useToast()

const projectId = route.params.id as string
const project = ref<ProjectDetail | null>(null)
const timeEntries = ref<TimeEntry[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    project.value = await apiFetch<ProjectDetail>(`/projects/${projectId}`)
    const entries = await apiFetch<{ items: TimeEntry[] }>(
      `/time-entries?projectId=${projectId}&pageSize=200`,
    )
    timeEntries.value = entries.items
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      void router.replace('/projects')
      return
    }
    toast.add({ severity: 'error', summary: 'Error', detail: 'Something went wrong.', life: 5000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())

const totalHours = computed(() =>
  timeEntries.value.reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0).toFixed(2),
)

function taskName(taskId: string | null): string {
  if (!taskId) return '—'
  return project.value?.tasks.find((t) => t.id === taskId)?.name ?? '—'
}

const taskOptions = computed(() => [
  { label: 'No specific task', value: null },
  ...(project.value?.tasks ?? []).map((t) => ({ label: t.name, value: t.id })),
])

// ─── Add task dialog ──────────────────────────────────────────────────────────
const taskDialogOpen = ref(false)
const taskName_ = ref('')
const taskSaving = ref(false)

function openTaskDialog() {
  taskName_.value = ''
  taskDialogOpen.value = true
}

async function submitTask() {
  if (!taskName_.value.trim()) return
  taskSaving.value = true
  try {
    await apiFetch(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ name: taskName_.value }),
    })
    taskDialogOpen.value = false
    toast.add({ severity: 'success', summary: 'Added', detail: 'Task added.', life: 3000 })
    await load()
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Could not add task.', life: 5000 })
  } finally {
    taskSaving.value = false
  }
}

// ─── Log time dialog ──────────────────────────────────────────────────────────
const timeDialogOpen = ref(false)
const timeTaskId = ref<string | null>(null)
const timeDate = ref(new Date())
const timeHours = ref('')
const timeDescription = ref('')
const timeBillable = ref(true)
const timeSaving = ref(false)
const timeError = ref('')

function openTimeDialog() {
  timeTaskId.value = null
  timeDate.value = new Date()
  timeHours.value = ''
  timeDescription.value = ''
  timeBillable.value = true
  timeError.value = ''
  timeDialogOpen.value = true
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function submitTime() {
  timeError.value = ''
  const hrs = parseFloat(timeHours.value)
  if (isNaN(hrs) || hrs <= 0) {
    timeError.value = 'Enter a positive number of hours.'
    return
  }
  timeSaving.value = true
  try {
    await apiFetch(`/projects/${projectId}/time-entries`, {
      method: 'POST',
      body: JSON.stringify({
        taskId: timeTaskId.value ?? undefined,
        entryDate: isoDate(timeDate.value),
        hours: hrs.toFixed(4),
        description: timeDescription.value || undefined,
        billable: timeBillable.value,
      }),
    })
    timeDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Logged',
      detail: 'Time entry recorded.',
      life: 3000,
    })
    await load()
  } catch (err) {
    timeError.value =
      err instanceof ApiError && err.status === 422
        ? 'A billable rate is required — set one on this entry, the task, or the project default.'
        : 'Something went wrong. Please try again.'
  } finally {
    timeSaving.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12">
    <div class="flex items-center gap-4 flex-wrap">
      <Button severity="secondary" text @click="() => void router.push('/projects')">
        <ArrowLeft class="w-4 h-4" />
        Projects
      </Button>
      <div v-if="project" class="flex-1">
        <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">
          {{ project.name }}
        </h2>
        <p v-if="project.description" class="text-surface-500 text-sm mt-0.5">
          {{ project.description }}
        </p>
      </div>
      <StatusTag v-if="project" :status="project.status" />
    </div>

    <template v-if="project">
      <div class="card p-6 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Default rate</p>
          <p class="font-medium">{{ project.defaultBillableRate ?? '—' }} / hr</p>
        </div>
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">GST category</p>
          <p class="font-medium">{{ project.defaultGstCategory }}</p>
        </div>
        <div>
          <p class="text-xs text-surface-500 uppercase tracking-wide mb-1">Total hours logged</p>
          <p class="font-medium">{{ totalHours }}</p>
        </div>
      </div>

      <div class="card overflow-hidden p-0!">
        <div
          class="px-6 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
        >
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Tasks</h3>
          <Button size="small" severity="secondary" @click="openTaskDialog">
            <Plus class="w-4 h-4" />
            Add Task
          </Button>
        </div>
        <DataTable :value="project.tasks" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>No tasks yet.</template>
          <Column field="name" header="Name" />
          <Column header="Status" style="width: 100px">
            <template #body="{ data }"><StatusTag :status="(data as Task).status" /></template>
          </Column>
          <Column header="Rate" style="width: 100px">
            <template #body="{ data }">{{ (data as Task).billableRate ?? '—' }}</template>
          </Column>
        </DataTable>
      </div>

      <div class="card overflow-hidden p-0!">
        <div
          class="px-6 py-4 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between"
        >
          <h3 class="text-sm font-medium text-surface-700 dark:text-surface-300">Time Entries</h3>
          <Button size="small" @click="openTimeDialog">
            <Plus class="w-4 h-4" />
            Log Time
          </Button>
        </div>
        <DataTable :value="timeEntries" :pt="{ root: { class: 'text-sm!' } }">
          <template #empty>No time logged yet.</template>
          <Column field="entryDate" header="Date" style="width: 120px">
            <template #body="{ data }"><DateCell :date="(data as TimeEntry).entryDate" /></template>
          </Column>
          <Column header="Task" style="width: 160px">
            <template #body="{ data }">{{ taskName((data as TimeEntry).taskId) }}</template>
          </Column>
          <Column field="description" header="Description" />
          <Column field="hours" header="Hours" class="text-right" style="width: 90px" />
          <Column header="Rate" class="text-right" style="width: 100px">
            <template #body="{ data }">
              <MoneyCell
                v-if="(data as TimeEntry).billableRate"
                :amount="(data as TimeEntry).billableRate"
              />
              <span v-else class="text-surface-400">—</span>
            </template>
          </Column>
          <Column header="Status" style="width: 100px">
            <template #body="{ data }">
              <span v-if="!(data as TimeEntry).billable" class="text-xs text-surface-400"
                >Non-billable</span
              >
              <span
                v-else-if="(data as TimeEntry).invoicedAt"
                class="text-xs text-primary-500 font-medium"
                >Invoiced</span
              >
              <span v-else class="text-xs text-surface-500">Billable</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>

    <Dialog v-model:visible="taskDialogOpen" header="Add Task" modal :style="{ width: '26rem' }">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Task name</label>
        <InputText v-model="taskName_" fluid />
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="taskDialogOpen = false" />
        <Button label="Add" :loading="taskSaving" @click="submitTask" />
      </template>
    </Dialog>

    <Dialog v-model:visible="timeDialogOpen" header="Log Time" modal :style="{ width: '28rem' }">
      <div class="space-y-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Task (optional)</label>
          <Select
            v-model="timeTaskId"
            :options="taskOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Date</label>
            <DatePicker v-model="timeDate" date-format="dd M yy" show-icon />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Hours</label>
            <InputText v-model="timeHours" inputmode="decimal" placeholder="e.g. 1.5" />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Description</label>
          <Textarea v-model="timeDescription" rows="2" auto-resize />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox v-model="timeBillable" binary input-id="time-billable" />
          <label for="time-billable" class="text-sm">Billable</label>
        </div>
        <small v-if="timeError" class="text-red-500">{{ timeError }}</small>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="timeDialogOpen = false" />
        <Button label="Log Time" :loading="timeSaving" @click="submitTime" />
      </template>
    </Dialog>
  </div>
</template>
