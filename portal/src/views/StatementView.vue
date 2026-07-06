<script setup lang="ts">
import { ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import DatePicker from 'primevue/datepicker'
import Button from 'primevue/button'
import { apiFetch } from '../lib/apiFetch.js'
import MoneyCell from './MoneyCell.vue'

type SoaEntry = {
  date: string
  type: 'invoice' | 'credit_note' | 'payment'
  ref: string
  description: string
  debit: string | null
  credit: string | null
  balance: string
}

type Soa = {
  from: string
  to: string
  openingBalance: string
  entries: SoaEntry[]
  closingBalance: string
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const today = new Date()
const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate())

const fromDate = ref<Date>(threeMonthsAgo)
const toDate = ref<Date>(today)
const soa = ref<Soa | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    soa.value = await apiFetch<Soa>(
      `/portal/statement?from=${isoDate(fromDate.value)}&to=${isoDate(toDate.value)}`,
    )
  } finally {
    loading.value = false
  }
}

load()
</script>

<template>
  <h1 class="text-xl font-semibold mb-4">Statement of account</h1>

  <div class="card mb-6 flex items-end gap-4">
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium">From</label>
      <DatePicker v-model="fromDate" date-format="yy-mm-dd" />
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium">To</label>
      <DatePicker v-model="toDate" date-format="yy-mm-dd" />
    </div>
    <Button label="Update" :loading="loading" @click="load" />
  </div>

  <div v-if="soa" class="card">
    <div class="flex justify-between text-sm mb-4">
      <span class="text-surface-500">Opening balance</span>
      <MoneyCell :amount="soa.openingBalance" />
    </div>

    <DataTable :value="soa.entries" data-key="ref">
      <template #empty>No activity in this period.</template>
      <Column field="date" header="Date" />
      <Column field="ref" header="Reference" />
      <Column field="description" header="Description" />
      <Column header="Debit">
        <template #body="{ data }"><MoneyCell :amount="data.debit" /></template>
      </Column>
      <Column header="Credit">
        <template #body="{ data }"><MoneyCell :amount="data.credit" /></template>
      </Column>
      <Column header="Balance">
        <template #body="{ data }"><MoneyCell :amount="data.balance" /></template>
      </Column>
    </DataTable>

    <div class="flex justify-between text-sm mt-4 font-semibold">
      <span>Closing balance</span>
      <MoneyCell :amount="soa.closingBalance" />
    </div>
  </div>
</template>
