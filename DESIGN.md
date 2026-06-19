# Design

> UI/UX conventions for this app. CLAUDE.md requires this file to be read at session start.
> Follow every pattern here exactly. Do not deviate unless the user explicitly asks.

---

## 1. Visual language

- **Tone:** functional, dense, professional. Accountants look at this all day; clarity beats decoration.
- **Spacing scale:** Tailwind defaults (`gap-2 / gap-4 / gap-6` etc.). No custom magic numbers. See §13 for the canonical spacing reference.
- **Type scale:** PrimeVue defaults; no global font overrides unless documented here.
- **Density:** compact is correct for this audience — dense DataTables, forms, and dialogs.

### Theme — `Roanuedhuru` preset (PrimeVue Aura, monochrome)

The app uses a custom preset called **`Roanuedhuru`** that maps **all primary colours to surface greys** (no blue). Every PrimeVue component — buttons, highlights, focus rings — is monochrome instead of the default Aura blue. Without this preset the design looks completely different. This is the only theme; no per-component colour overrides outside the theme config.

The full `web/src/main.ts`:

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
import 'primeicons/primeicons.css'
import App from './App.vue'
import { router } from './router/index.js'
import './assets/main.css'

const Roanuedhuru = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{surface.50}',
      100: '{surface.100}',
      200: '{surface.200}',
      300: '{surface.300}',
      400: '{surface.400}',
      500: '{surface.500}',
      600: '{surface.600}',
      700: '{surface.700}',
      800: '{surface.800}',
      900: '{surface.900}',
      950: '{surface.950}',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{surface.950}',
          inverseColor: '#ffffff',
          hoverColor: '{surface.900}',
          activeColor: '{surface.800}',
        },
        highlight: {
          background: '{surface.200}',
          focusBackground: '{surface.300}',
          color: '{surface.800}',
          focusColor: '{surface.900}',
        },
      },
      dark: {
        primary: {
          color: '{surface.50}',
          inverseColor: '{surface.950}',
          hoverColor: '{surface.100}',
          activeColor: '{surface.200}',
        },
        highlight: {
          background: 'rgba(250,250,250,.16)',
          focusBackground: 'rgba(250,250,250,.24)',
          color: 'rgba(255,255,255,.87)',
          focusColor: 'rgba(255,255,255,.87)',
        },
      },
    },
  },
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: { preset: Roanuedhuru, options: { darkModeSelector: '.dark' } },
})
app.use(ConfirmationService)
app.use(ToastService)
app.mount('#app')
```

### Dark mode (required)

A single toggle button (sun/moon icon) in the top bar cycles light/dark.

- PrimeVue dark mode via the `.dark` class selector (`darkModeSelector: '.dark'` above), toggled on `<html>` by `document.documentElement.classList.toggle('dark', isDark)`.
- Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` in `main.css` so the `dark:` utility prefix maps to the same `.dark` selector.
- Layout elements (sidebar, topbar, breadcrumb, page background, cards) require explicit `dark:bg-surface-*` / `dark:text-surface-*` / `dark:border-surface-*` classes — PrimeVue's raw surface palette (`--p-surface-*`) is a fixed scale and does not invert automatically. PrimeVue component internals handle their own dark mode via the theme system.
- `.dark .card` override in `main.css` sets card background to `--p-surface-800` and border to `--p-surface-700`.
- Choice persisted in the Pinia `ui` store (`localStorage` key `koosani-theme`) and synced to `prefers-color-scheme` when set to "system". Default on first visit: system.

### Global CSS — `web/src/assets/main.css`

```css
@import 'tailwindcss';
@plugin "tailwindcss-primeui";
@custom-variant dark (&:where(.dark, .dark *));

.card {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow:
    0 1px 3px 0 rgb(0 0 0 / 0.06),
    0 1px 2px -1px rgb(0 0 0 / 0.04);
}
```

`.card` is a **custom CSS class**, not a Tailwind utility. Use it as-is — never replace it with Tailwind classes.

---

## 2. PrimeVue + Tailwind boundary

This is the most-violated rule in mixed PrimeVue/Tailwind projects. The boundary is:

| Concern                                                               | Tool                                        |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Page layout (grids, flex, gap, spacing between blocks)                | **Tailwind**                                |
| Component internals (button color, table row hover, dialog header bg) | **PrimeVue theme** or `pt` prop             |
| One-off tweaks to a PrimeVue component                                | **PrimeVue `pt`**, not Tailwind in the slot |
| Plain HTML markup styling                                             | **Tailwind**                                |

Why: PrimeVue's classes change between versions; Tailwind utilities sprinkled in component slots break silently on upgrade.

**Hard rule — no unapproved overrides.** Do not override PrimeVue component styles with custom CSS, `<style>` blocks, scoped styles, `!important`, deep selectors (`:deep()`, `::v-deep`), or global stylesheets targeting PrimeVue classes. All component styling goes through the `Roanuedhuru` theme config or the `pt` pass-through prop. Any custom CSS that touches a PrimeVue component requires explicit owner approval **before** it is written — propose it, do not implement it.

**Allowed inside PrimeVue slots:** layout-only utilities (`flex`, `grid`, `gap-*`, `p-*`, `m-*`, `w-*`, `h-*`, text alignment).
**Not allowed:** color, background, border, shadow, font utilities inside PrimeVue component slots.

### CRITICAL — Tailwind v4 `!important` syntax

Tailwind v4 uses a **suffix** for `!important`, not a prefix:

```
✅ Correct (v4):  p-0!   text-sm!   border-t!   pt-2!   bg-surface-900!
❌ Wrong (v3):   !p-0   !text-sm   !border-t   !pt-2   !bg-surface-900
```

Use the suffix everywhere, including inside PrimeVue `pt` class strings (where layout-only utilities are permitted per the table above).

---

## 3. Component conventions

- **One screen = one view component** under `web/src/modules/<module>/views/`.
- **Shared UI primitives** (page header, empty state, confirm dialog wrapper, money cell, date cell, chart wrappers) live in `web/src/shared/ui/`.
- **No prop-drilling more than two levels.** Reach for Pinia or `provide`/`inject` before three.
- **Composition API + `<script setup lang="ts">` only.** TypeScript strict; no plain-JS components, no Options API, no JSX.
- **Filenames:** PascalCase for components, camelCase for composables (`useInvoiceDraft.ts`). All local imports use the `.js` extension (ESM).

### SFC structure

Order: `<script setup>` → `<template>` → `<style>` (style is almost never used — prefer Tailwind / the theme).

**Import order inside `<script setup lang="ts">`:**

1. Vue composables (`ref`, `computed`, `watch`, `onMounted`)
2. Third-party libraries
3. PrimeVue components
4. Lucide icons
5. Pinia stores / shared lib (`apiFetch`)
6. Local components
7. Type imports (`import type { ... }`), including Zod-derived types from `@koosani/shared`

```typescript
import { ref, computed, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import { Plus, Search } from 'lucide-vue-next'
import { useInvoicesStore } from '../../invoicing/store.js'
import InvoiceDrawer from '../InvoiceDrawer.vue'
import type { Invoice } from '@koosani/shared'
```

---

## 4. Forms

- Every form binds to a **Zod schema imported from `@koosani/shared`**. The backend re-validates with the same schema. One form = one schema; never duplicate validation. (CLAUDE.md §5)
- Show field-level errors inline under each input. No alert-bar form errors except for server-side 500s.
- Disable the submit button while the request is in flight (`:loading`); never rely on a global spinner.
- **Money & quantity inputs use the dedicated `<MoneyInput>` component**, which stores a string internally and emits a `Decimal`-compatible string. **Never bind a money or quantity field to a `Number` ref** (CLAUDE.md §4). PrimeVue `InputNumber` is only for genuinely non-financial integers.
- Date inputs use PrimeVue **`DatePicker`** (the Aura v4 successor to `Calendar`) with the `Indian/Maldives` timezone; never the browser's native date picker (inconsistent across OS).

### Field markup

```vue
<!-- single field -->
<div class="space-y-1.5">
  <label class="block text-sm font-semibold text-surface-800">Name <span class="text-red-500">*</span></label>
  <InputText v-model="form.name" class="w-full" />
</div>

<!-- two-column row -->
<div class="flex gap-3">
  <div class="flex-1 space-y-1.5">
    <label class="block text-sm font-semibold text-surface-800">Field A</label>
    <InputText v-model="form.fieldA" class="w-full" />
  </div>
  <div class="flex-1 space-y-1.5">
    <label class="block text-sm font-semibold text-surface-800">Field B</label>
    <InputText v-model="form.fieldB" class="w-full" />
  </div>
</div>

<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
```

### DatePicker

```vue
<!-- Date only -->
<DatePicker v-model="form.dueDate" date-format="dd M yy" show-icon class="w-full" />

<!-- Date + time -->
<DatePicker
  v-model="form.datetime"
  date-format="dd M yy"
  show-icon
  show-time
  hour-format="24"
  class="w-full"
/>

<!-- Time only -->
<DatePicker v-model="form.time" time-only hour-format="24" class="w-32" />
```

`v-model` is always `Date | null`. These helpers are used wherever a DatePicker maps to/from an API string:

```typescript
// DatePicker Date → 'YYYY-MM-DD' for API submission
function fmtDate(d: Date | null): string | null {
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO string → Date for populating the picker on edit
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// ISO string → human-readable for table display (DD MMM YYYY)
function fmtDateDisplay(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
```

### Checkbox

```vue
<div class="flex items-center gap-2">
  <Checkbox v-model="form.isActive" binary input-id="is-active" />
  <label for="is-active" class="text-sm text-surface-700">Active</label>
</div>
```

### Textarea

```vue
<Textarea v-model="form.notes" rows="3" class="w-full resize-none" />
```

---

## 5. Data tables

- PrimeVue `DataTable` with **server-side** pagination, sort, and filter on every list view that can exceed ~50 rows. Use the shared `EntityList.vue` wrapper for the standard list shape.
- Columns:
  - **Money columns** are right-aligned, tabular numerals, two decimal places, no thousands separator inside the number (use the locale formatter for display only). Render via `<MoneyCell>`.
  - **Status columns** use a `<StatusTag>` component (one color per status; documented in `web/src/shared/ui/StatusTag.vue`).
  - **Date columns** use `<DateCell>` (DD MMM YYYY).
- Row click opens detail; never a button-in-row "view" link (wastes a click).
- Bulk actions (when present) live in a toolbar above the table, disabled when nothing selected.

### Standard DataTable markup

```vue
<div class="card overflow-hidden p-0!">
  <DataTable
    :value="rows"
    :loading="store.loading"
    striped-rows
    scrollable
    paginator
    lazy
    :rows="pageSize"
    :total-records="store.total"
    :rows-per-page-options="[10, 25, 50, 100]"
    paginator-template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
    removable-sort
    @row-click="goToDetail($event.data)"
    @page="onPage"
    @sort="onSort"
    :pt="{
      root:      { class: 'text-sm!' },
      paginator: { class: 'border-t! border-surface-100! px-4! py-3!' },
    }"
  >
    <template #empty>
      <div class="text-center py-12 text-surface-400 text-sm">No items found.</div>
    </template>

    <Column field="number" header="Number" sortable style="min-width: 140px" />

    <Column field="status" header="Status">
      <template #body="{ data }: { data: Invoice }">
        <StatusTag :status="data.status" />
      </template>
    </Column>
  </DataTable>
</div>
```

**DataTable mutation rule** — the `data` in slot templates is a processed copy, not the reactive source. Never mutate it directly; look the item up in the source ref (or refetch) instead:

```typescript
const row = store.items.find((r) => r.id === data.id)
if (row) row.someField = newValue
```

---

## 6. Forms vs. drawers vs. dialogs

| When                                                   | Use                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Quick edit of a small record (customer phone, contact) | PrimeVue `Drawer` from the right                                      |
| Create / edit of a complex record (invoice, PO, bill)  | Full-page view, not a dialog                                          |
| Destructive confirm                                    | PrimeVue `ConfirmDialog` (via `useConfirm`)                           |
| Multi-step wizards                                     | Avoid. If genuinely needed, full-page with a left-side step indicator |

### Dialog / drawer pattern

Self-contained components manage their own `visible` ref and emit `close` + `saved`.

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { CustomerCreate } from '@koosani/shared'
import type { Customer } from '@koosani/shared'

const props = defineProps<{ item?: Customer | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const visible = ref(true)
const isEdit = computed(() => !!props.item)
const loading = ref(false)
const error = ref('')
const form = ref({ name: '', email: '' })

onMounted(() => {
  if (props.item) form.value = { name: props.item.name, email: props.item.email ?? '' }
})

async function submit() {
  error.value = ''
  const parsed = (isEdit.value ? CustomerCreate.partial() : CustomerCreate).safeParse(form.value)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  loading.value = true
  try {
    isEdit.value ? await store.update(props.item!.id, parsed.data) : await store.create(parsed.data)
    emit('saved')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to save'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="isEdit ? 'Edit customer' : 'Add customer'"
    modal
    :style="{ width: '36rem' }"
    :closable="false"
    :pt="{ content: { class: 'space-y-4 pt-2!' } }"
    @after-hide="emit('close')"
  >
    <!-- fields … -->
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" @click="emit('close')" />
        <Button
          :label="isEdit ? 'Save changes' : 'Add customer'"
          :loading="loading"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>
```

**Dialog rules:**

- `visible = ref(true)` — always initialised `true`; PrimeVue drives the animation via this ref.
- `:closable="false"` — no X button; user closes via Cancel.
- `@after-hide="emit('close')"` — fires after the hide animation; lets the parent unmount.
- Width: `36rem` for forms, `56rem`+ for preview tables.

**Destructive confirm** uses `useConfirm` + `<ConfirmDialog />` (mounted once in `App.vue`) — never `window.confirm()` / `alert()`:

```typescript
const confirm = useConfirm()
function remove(item: Customer) {
  confirm.require({
    header: 'Delete customer',
    message: `Delete ${item.name}? This cannot be undone.`,
    acceptProps: { severity: 'danger', label: 'Delete' },
    accept: () => store.remove(item.id),
  })
}
```

---

## 7. Empty states

Every list view has an empty state. Three flavours, pick the right one:

1. **First-time** — "No customers yet" + a Create button.
2. **Filtered to nothing** — "No customers match your filters" + a Clear filters button.
3. **Permission-restricted** — "You don't have access to view customers" + contact admin hint.

A blank table is never acceptable.

---

## 8. Errors

`apiFetch` throws `ApiError(status, message)` and handles 401 centrally (redirect to login) — views never special-case 401.

- 401 → redirect to login (handled by `apiFetch`, not per-view).
- 403 → toast: "You don't have permission to do that."
- 404 on a detail view → dedicated 404 view with a back link, not a toast.
- 422 (validation) → field-level errors on the form.
- 5xx → toast: "Something went wrong. Please try again." + log the request id for support reference.

Catch blocks narrow on `ApiError`; never assume a body shape:

```typescript
catch (e) {
  error.value = e instanceof ApiError ? e.message : 'Failed to save'
}
```

Never display backend error messages verbatim in auth views (per SECURITY.md). Outside auth, a sanitised backend message is acceptable if and only if the api explicitly marks it as user-facing.

---

## 9. Charts

- Chart.js via `vue-chartjs`. One wrapper component per chart type (`<BarChart>`, `<SalesByDayChart>`). No generic mega-chart component.
- Money axes use the same formatter as `<MoneyCell>`.
- Colors: chart palette is a fixed array in `web/src/shared/ui/chartColors.ts` (`CHART_COLORS` + muted `CHART_COLORS_MUTED`). Five colors max; if you need more categories, group the tail into "Other".
- No 3D charts. No pie charts with more than five slices.

---

## 10. Accessibility floor

- All interactive elements reachable by keyboard.
- All form inputs have a `<label>` (or `aria-label` for icon-only controls).
- Color is never the sole carrier of meaning (status uses color + text).
- Contrast: the `Roanuedhuru` palette meets WCAG AA in **both** light and dark; re-check any token override against both modes.

---

## 11. App shell

`web/src/App.vue` is just a `<RouterView />` plus the singletons `<ConfirmDialog />` and `<Toast />`. The authenticated shell is `AppLayout.vue`, which every protected route renders through.

### AppLayout.vue

```vue
<template>
  <div class="flex min-h-dvh bg-surface-50 dark:bg-surface-950 overflow-hidden">
    <AppSidebar v-model:mobile-open="sidebarOpen" />

    <div class="flex flex-col flex-1 min-w-0">
      <AppTopBar v-model:notif-open="notifOpen" @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="flex-1 overflow-y-auto p-4 md:p-6 pb-20 lg:pb-6">
        <RouterView />
      </main>
    </div>

    <!-- mobile bottom nav -->
    <nav
      class="fixed bottom-0 inset-x-0 bg-surface-0 dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700 flex lg:hidden z-30"
    >
      <RouterLink
        v-for="item in bottomNav"
        :key="item.to"
        :to="item.to"
        class="flex-1 flex flex-col items-center py-2 text-xs gap-1 text-surface-500 hover:text-surface-900 transition-colors"
        active-class="text-surface-900! font-medium"
      >
        <component :is="iconMap[item.icon]" class="w-5 h-5" />
        {{ item.label }}
      </RouterLink>
    </nav>
  </div>
</template>
```

**Key layout tokens:**

- Page background: `bg-surface-50` (light grey, not white).
- Content padding: `p-4 md:p-6` with `pb-20 lg:pb-6` for mobile bottom-nav clearance.
- All views render inside `<main>` via `<RouterView />`.

### AppSidebar.vue

- **Mobile:** PrimeVue `<Drawer>` overlay, slides in from left, `w-64`.
- **Tablet (md):** fixed aside `w-16` — icons only (text hidden with `md:hidden lg:block`).
- **Desktop (lg):** fixed aside `w-64` — icons and labels.
- Background: `bg-surface-0`, right border: `border-r border-surface-200`.
- A spacer `<div class="hidden md:block md:w-16 lg:w-64">` pushes main content right.

**Active nav item** style: `bg-surface-900! text-surface-0! hover:bg-surface-800!` — dark background, white text.
**Inactive:** `text-surface-600 hover:bg-surface-100 hover:text-surface-900`.

### AppTopBar.vue

Holds: hamburger (mobile only), page title (`flex-1 text-base font-semibold text-surface-900`), optional live clock (`font-mono tabular-nums`), the dark-mode toggle (sun/moon), the notification bell with unread badge, and the user avatar + `Menu` popup. Topbar height is `h-16`, surface `bg-surface-0`, bottom border `border-surface-200`. Button backgrounds use `bg-surface-200 hover:bg-surface-300`.

### View layout

Every view follows this shell inside `<main>`:

```vue
<template>
  <div class="space-y-6">
    <!-- header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-semibold text-surface-900">Page Title</h2>
        <p class="text-surface-500 mt-0.5">Subtitle or count</p>
      </div>
      <div v-if="canManage" class="flex items-center gap-2">
        <Button severity="secondary" @click="...">
          <Icon class="w-4 h-4" /> Secondary Action
        </Button>
        <Button @click="..."> <Plus class="w-4 h-4" /> Primary Action </Button>
      </div>
    </div>

    <!-- filters row -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative">
        <Search
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none"
        />
        <InputText v-model="search" placeholder="Search…" class="pl-9 w-72" />
      </div>
      <Select
        v-model="filterValue"
        :options="OPTIONS"
        option-label="label"
        option-value="value"
        class="w-44"
      />
      <Button
        v-if="search || filterValue"
        label="Reset"
        severity="secondary"
        text
        @click="
          search = ''
          filterValue = null
        "
      />
      <span class="ml-auto text-xs text-surface-400">{{ total }} items</span>
    </div>

    <!-- table card (see §5) -->
    <div class="card overflow-hidden p-0!">
      <DataTable ... />
    </div>
  </div>
</template>
```

---

## 12. Pinia store pattern

All HTTP goes through `apiFetch` (never raw `axios`/`fetch` in a store) so 401 redirects, base URL, and credentials are handled centrally.

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '../../lib/apiFetch.js'
import type { Customer } from '@koosani/shared'

export const useCustomersStore = defineStore('customers', () => {
  const items = ref<Customer[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')

  async function fetchPage(params: Record<string, string> = {}) {
    loading.value = true
    error.value = ''
    try {
      const qs = new URLSearchParams(params).toString()
      const res = await apiFetch<{ data: Customer[]; total: number }>(
        `/customers${qs ? `?${qs}` : ''}`,
      )
      items.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Failed to load'
    } finally {
      loading.value = false
    }
  }

  async function create(payload: Partial<Customer>): Promise<Customer> {
    const created = await apiFetch<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    items.value.unshift(created)
    return created
  }

  async function update(id: string, payload: Partial<Customer>): Promise<Customer> {
    const updated = await apiFetch<Customer>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    const idx = items.value.findIndex((i) => i.id === id)
    if (idx !== -1) items.value[idx] = updated
    return updated
  }

  async function remove(id: string) {
    await apiFetch(`/customers/${id}`, { method: 'DELETE' })
    items.value = items.value.filter((i) => i.id !== id)
  }

  return { items, total, loading, error, fetchPage, create, update, remove }
})
```

**Rules:**

- `<script setup>`-style setup stores only — never the options-object form.
- `loading` and `error` are always separate refs.
- `create*` / `update*` / `remove*` throw on error — let the calling component catch and display.
- `fetch*` swallows the error into `error.value`.
- Optimistic local updates: `unshift` on create, index-replace on update, `filter` on delete.

### Permission guards

```typescript
const auth = useAuthStore()
const canManage = computed(() => !!auth.user && ['admin', 'manager'].includes(auth.user.role))
const canEdit = computed(() => auth.hasPermission('invoicing', 'edit'))
```

Gate buttons, action columns, and modals with `v-if="canManage"`. Never hide the DataTable itself (use the permission-restricted empty state from §7 instead).

---

## 13. Reference tables

### Color tokens

| Token              | Use                                                |
| ------------------ | -------------------------------------------------- |
| `text-surface-900` | Page headings, primary table text, active nav      |
| `text-surface-800` | Form labels                                        |
| `text-surface-700` | Secondary body text                                |
| `text-surface-600` | Nav links (inactive), helper text                  |
| `text-surface-500` | Muted (subtitles, empty state, clock)              |
| `text-surface-400` | Very muted (icon colour, timestamps, count badges) |
| `text-surface-300` | Version text                                       |
| `bg-surface-0`     | White — sidebar, topbar, cards, modal              |
| `bg-surface-50`    | Page background                                    |
| `bg-surface-100`   | Hover state on nav items                           |
| `bg-surface-200`   | Topbar button backgrounds (bell, user avatar)      |
| `bg-surface-900`   | Active nav item, user avatar circle                |
| `text-surface-0`   | White text on dark backgrounds                     |
| `text-red-600`     | Inline form errors                                 |
| `text-red-500`     | Required field asterisk                            |
| `text-green-600`   | Success states                                     |
| `bg-red-500`       | Notification badge                                 |

### Spacing

| Context                    | Class                               |
| -------------------------- | ----------------------------------- |
| View section gap           | `space-y-6`                         |
| Card internal sections     | `space-y-4`                         |
| Form field (label + input) | `space-y-1.5`                       |
| Filter row                 | `flex flex-wrap items-center gap-3` |
| Button group               | `flex items-center gap-2`           |
| Dialog footer buttons      | `flex justify-end gap-2`            |
| Nav items gap              | `space-y-0.5`                       |

### Control widths

| Control                    | Width    |
| -------------------------- | -------- |
| Search input               | `w-72`   |
| Status / resource select   | `w-44`   |
| Department select          | `w-48`   |
| Short select (role/action) | `w-40`   |
| Time-only picker           | `w-32`   |
| All form fields            | `w-full` |

### Icon sizes (Lucide via `lucide-vue-next`)

| Context                                     | Class                                          |
| ------------------------------------------- | ---------------------------------------------- |
| Button icon, sidebar nav item               | `w-4 h-4`                                      |
| Small toggle buttons (eye, etc.)            | `w-3.5 h-3.5`                                  |
| Topbar (bell, hamburger), mobile bottom nav | `w-5 h-5`                                      |
| Search input prefix                         | `w-4 h-4 text-surface-400 pointer-events-none` |

### Status label / severity maps

Status label + `<StatusTag>` severity maps are **local constants in the view/component file**, not in shared types. Use literal union types for enums (never TypeScript `enum`); the unions come from the `@koosani/shared` Zod schemas.

```typescript
const STATUS_LABELS: Record<Invoice['status'], string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
}
const STATUS_SEVERITY: Record<Invoice['status'], string> = {
  draft: 'secondary',
  issued: 'info',
  partially_paid: 'warn',
  paid: 'success',
  void: 'danger',
}
```

Severity values: `'success' | 'info' | 'warn' | 'danger' | 'secondary'`.

---

## 14. Change protocol

Adding a new component pattern or breaking a rule above:

1. Update this file (with the reason for the new pattern).
2. `CHANGELOG.md > Changed` entry.
3. If the pattern is reusable, extract it into `web/src/shared/ui/` in the same PR.
