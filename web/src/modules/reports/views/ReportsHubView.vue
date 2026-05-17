<script setup lang="ts">
import { useRouter } from 'vue-router'
import { TrendingUp, TrendingDown, Package, Users, Building2, FileText } from 'lucide-vue-next'

const router = useRouter()

const reports = [
  {
    key: 'sales',
    title: 'Sales Report',
    description: 'Issued invoices net of credit notes, grouped by customer, item, or day.',
    icon: TrendingUp,
    path: '/reports/sales',
    color: 'text-indigo-500',
  },
  {
    key: 'purchases',
    title: 'Purchases Report',
    description: 'Confirmed bills grouped by supplier, item, or day.',
    icon: TrendingDown,
    path: '/reports/purchases',
    color: 'text-rose-500',
  },
  {
    key: 'stock-valuation',
    title: 'Stock Valuation',
    description: 'Inventory value as of any date using weighted average or FIFO cost.',
    icon: Package,
    path: '/reports/stock-valuation',
    color: 'text-amber-500',
  },
  {
    key: 'aged-receivables',
    title: 'Aged Receivables',
    description: 'Outstanding customer invoices bucketed by age.',
    icon: Users,
    path: '/reports/aged-receivables',
    color: 'text-emerald-500',
  },
  {
    key: 'aged-payables',
    title: 'Aged Payables',
    description: 'Outstanding supplier bills bucketed by age.',
    icon: Building2,
    path: '/reports/aged-payables',
    color: 'text-violet-500',
  },
  {
    key: 'gst-summary',
    title: 'GST Summary',
    description: 'Output vs input tax preview for any date range.',
    icon: FileText,
    path: '/reports/gst-summary',
    color: 'text-sky-500',
  },
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-2xl font-semibold text-surface-900 dark:text-surface-50">Reports</h2>
      <p class="text-surface-500 dark:text-surface-400 mt-0.5">
        Generate and export financial reports.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <button
        v-for="report in reports"
        :key="report.key"
        class="card p-6 text-left hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer"
        @click="() => void router.push(report.path)"
      >
        <component :is="report.icon" class="w-5 h-5 mb-3" :class="report.color" />
        <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-1">
          {{ report.title }}
        </h3>
        <p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
          {{ report.description }}
        </p>
      </button>
    </div>
  </div>
</template>
