import type { ColumnPassThroughMethodOptions } from 'primevue/column'

// Shared per-<Column> pass-through for EntityList's mobile-stacked DataTable
// (see EntityList.vue's own `pt` for the row/cell layout side of this).
// Reads the column's own `header` prop so every list view's Columns can just
// bind `:pt="stackPt"` — no need to repeat the label as a separate string.
export function stackPt(options: ColumnPassThroughMethodOptions) {
  return {
    bodyCell: {
      class:
        'flex! justify-between! items-baseline gap-3 py-1! before:content-[attr(data-label)] before:font-medium before:text-surface-500 dark:before:text-surface-400 before:shrink-0 md:table-cell! md:py-3! md:before:content-none!',
      'data-label': options.props.header,
    },
  }
}
