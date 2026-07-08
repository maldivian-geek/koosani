# Responsive sidebar navigation — design spec

Date: 2026-07-08

## Problem

`web/src/shared/ui/SidebarNav.vue` renders the whole nav as `<aside class="hidden md:flex ...">` — below the `md` breakpoint (768px) it doesn't render at all, and nothing replaces it. There's no hamburger button, no drawer, no bottom nav. On a phone, a signed-in user can see whatever page they landed on and nothing else; there's no way to navigate to any other section.

`DESIGN.md` §11 already documents the intended responsive behavior (mobile drawer via hamburger, tablet icon-only rail, desktop full sidebar, mobile bottom nav) — it was written but never actually implemented. The doc also references component names (`AppSidebar.vue`, `AppTopBar.vue`) and a notification bell that don't match the real codebase (`SidebarNav.vue`, `TopBar.vue`, no notifications feature exists anywhere).

## Scope

Build the full responsive spec, with two deliberate deviations from `DESIGN.md`'s literal snippet (confirmed with the user):

1. **Bottom nav breakpoint:** phone-only (`hidden md:hidden`, i.e. visible below `md`), not `lg:hidden` as the doc's snippet showed. At `md` the icon-rail sidebar is already visible, so showing the bottom nav too would be two navigation UIs competing for space on the same tablet screen.
2. **Notification bell:** added as a static placeholder (icon + `title="Notifications (coming soon)"`, no click handler, no store, no backend call) to match the topbar's documented layout, but explicitly not wired to any real feature — none exists in this codebase yet.

Bottom nav content: **Dashboard, Invoices, Customers, More** — the first three are direct links; "More" opens the same drawer the hamburger opens (not a 4th independent nav destination).

## Components

### 1. New: `web/src/shared/ui/SidebarContent.vue`

Extracts the current `SidebarNav.vue` template (brand block, nav groups computed from `authStore.user?.role`, user avatar + name/role + sign-out button) into a standalone presentational component so both the mobile drawer and the fixed aside render identical content instead of two maintained copies.

Prop: `compact: boolean` (default `false`).

- `compact = false` (used inside the Drawer): every label (brand text, nav item labels, user name/role, "Sign out" text) always renders.
- `compact = true` (used inside the fixed aside): every label gets `md:hidden lg:block` — hidden at tablet width (icon-only rail), visible again at desktop (full labels). Icons always render regardless of `compact`.

No other behavior changes — same nav groups, same active-link logic, same sign-out button, moved verbatim.

### 2. Rewritten: `web/src/shared/ui/SidebarNav.vue`

Becomes a thin wrapper composing two renders of `SidebarContent`:

```
<Drawer position="left" :visible="mobileOpen" @update:visible="...">
  <SidebarContent />                <!-- compact=false -->
</Drawer>

<aside class="hidden md:flex ... w-16 lg:w-64">
  <SidebarContent compact />
</aside>
```

- Props: `mobileOpen: boolean` (v-model target, i.e. `defineProps<{ mobileOpen: boolean }>()` + `defineEmits<{ 'update:mobileOpen': [boolean] }>()`, used by the parent as `v-model:mobile-open`).
- The Drawer's `:style` sets width to match the existing sidebar width convention (`w-64` equivalent, `420px`-style inline `:style` per the existing Drawer usage convention in e.g. `CustomerDrawer.vue`, but `256px`/`16rem` here to match `w-64`).
- Watches the route (`watch(() => route.path, ...)`) and emits `update:mobileOpen(false)` on every navigation, so tapping a nav link inside the drawer closes it automatically instead of leaving it open over the newly-navigated page.
- The fixed `<aside>` keeps its current responsive width classes (`hidden md:flex`, `w-16 lg:w-64`) — unchanged from today except that its content now comes from `<SidebarContent compact />` instead of inline markup.

### 3. `web/src/shared/ui/TopBar.vue`

- New hamburger button, first element in the header, class `md:hidden` (mobile only — the icon-rail aside is already visible at `md+`), emits a `toggle-sidebar` event on click. Icon: `Menu` from `lucide-vue-next`, imported aliased (`import { Menu as MenuIcon } from 'lucide-vue-next'`) to avoid the existing `Menu` import from `primevue/menu`.
- New placeholder bell button, styled consistent with the existing dark-mode toggle button (`bg-surface-200 hover:bg-surface-300` etc.) but with no `@click` handler and `title="Notifications (coming soon)"` so it doesn't read as a broken interactive control. Icon: `Bell` from `lucide-vue-next`.
- No other changes — existing dark-mode toggle and user avatar menu untouched.

### 4. `web/src/shared/ui/AppLayout.vue`

- New local `sidebarOpen = ref(false)`.
- `<SidebarNav v-model:mobile-open="sidebarOpen" />`
- `<TopBar @toggle-sidebar="sidebarOpen = !sidebarOpen" />`
- New mobile bottom nav, `<nav class="fixed bottom-0 inset-x-0 ... flex md:hidden z-30">` (phone-only per the scope decision above): three `RouterLink`s (Dashboard/Invoices/Customers, reusing icons already imported in `SidebarContent.vue`'s nav-item data — `LayoutDashboard`, `FileText`, `Users`) plus a fourth plain `<button>` ("More", `Menu` icon) that sets `sidebarOpen = true` directly (same drawer as the hamburger).
- `<main>`'s padding changes from `p-4 md:p-6` to `p-4 md:p-6 pb-20 md:pb-6` — extra bottom clearance for the bottom nav below `md`, back to normal at `md+` where the bottom nav is hidden.

## Docs to update alongside

- **`DESIGN.md` §11** — replace the aspirational snippet/description with what's actually built: correct component filenames (`SidebarNav.vue`/`TopBar.vue`, not `AppSidebar.vue`/`AppTopBar.vue`), the bottom-nav breakpoint (`md`, not `lg`, with the reasoning above), and a note that the notification bell is currently a layout placeholder with no backing feature.
- **`CHANGELOG.md`** — new entry under `[Unreleased] > Added` (or `Fixed`, since it's closing a gap between docs and reality) describing the new mobile drawer, tablet icon-rail, and bottom nav.

## Testing

Pure layout/interaction work — no new service functions, so no new unit tests per CLAUDE.md's testing rule (scoped to service functions and routes). Verification is manual: run the dev server, check phone/tablet/desktop widths via browser devtools, confirm the hamburger opens the drawer, the drawer closes on navigation, the tablet rail shows icons only, the desktop rail shows icons + labels, and the bottom nav's "More" button opens the same drawer.

## Out of scope

- Building an actual notifications feature (store, backend, unread badge) — bell is a static placeholder only, per explicit user decision.
- Any change to nav _content_ (which links exist, permission gating) — this is purely about making the existing nav reachable at every screen size.
