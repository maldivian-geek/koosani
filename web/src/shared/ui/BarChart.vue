<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { CHART_COLORS_MUTED } from './chartColors.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const props = withDefaults(
  defineProps<{
    labels: string[]
    datasets: Array<{ label: string; data: number[]; backgroundColor?: string | string[] }>
    height?: number
    showLegend?: boolean
  }>(),
  { height: 220, showLegend: false },
)

const chartData = computed(() => ({
  labels: props.labels,
  datasets: props.datasets.map((ds, i) => ({
    ...ds,
    backgroundColor: ds.backgroundColor ?? CHART_COLORS_MUTED[i % CHART_COLORS_MUTED.length],
    borderRadius: 3,
    borderSkipped: false,
  })),
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: props.showLegend },
    tooltip: {
      callbacks: {
        label: (ctx: { dataset: { label: string }; parsed: { y: number } }) =>
          `${ctx.dataset.label}: MVR ${ctx.parsed.y.toFixed(2)}`,
      },
    },
  },
  scales: {
    y: {
      ticks: { callback: (v: unknown) => `MVR ${Number(v).toFixed(0)}` },
      grid: { color: 'rgba(0,0,0,0.06)' },
    },
    x: {
      grid: { display: false },
    },
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Bar :data="chartData" :options="chartOptions as never" />
  </div>
</template>
