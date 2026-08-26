import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import type { PermissionResource } from '@koosani/shared'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    public?: boolean
    title?: string
    // Phase 37 — mirrors the resource a route's data is gated on server-side
    // (SidebarContent.vue uses the same mapping). Checked in the global
    // guard below; the real enforcement is the api route middleware, this
    // just avoids landing a staff user on a screen that will 403.
    resource?: PermissionResource
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      component: () => import('../modules/auth/views/LoginView.vue'),
      meta: { public: true, title: 'Login' },
    },
    {
      path: '/forgot-password',
      component: () => import('../modules/auth/views/MagicLinkView.vue'),
      meta: { public: true, title: 'Forgot Password' },
    },
    {
      path: '/reset-password',
      component: () => import('../modules/auth/views/ResetPasswordView.vue'),
      meta: { public: true, title: 'Reset Password' },
    },
    {
      path: '/magic-link',
      component: () => import('../modules/auth/views/MagicLinkVerifyView.vue'),
      meta: { public: true, title: 'Signing in…' },
    },
    {
      path: '/sign-in-link',
      component: () => import('../modules/auth/views/MagicLinkRequestView.vue'),
      meta: { public: true, title: 'Sign in with a link' },
    },
    {
      path: '/accept-invite',
      component: () => import('../modules/auth/views/AcceptInviteView.vue'),
      meta: { public: true, title: 'Accept Invitation' },
    },
    {
      path: '/',
      component: () => import('../shared/ui/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          component: () => import('../modules/dashboard/views/DashboardView.vue'),
          meta: { requiresAuth: true, title: 'Dashboard' },
        },
        {
          path: 'customers',
          component: () => import('../modules/customers/views/CustomersView.vue'),
          meta: { requiresAuth: true, title: 'Customers', resource: 'customers' },
        },
        {
          path: 'suppliers',
          component: () => import('../modules/suppliers/views/SuppliersView.vue'),
          meta: { requiresAuth: true, title: 'Suppliers', resource: 'suppliers' },
        },
        {
          path: 'items',
          component: () => import('../modules/items/views/ItemsView.vue'),
          meta: { requiresAuth: true, title: 'Items', resource: 'items' },
        },
        // Inventory UI (Phase 33, UPGRADE.md G-13/F-24 — API existed since
        // earlier phases, this closes the missing-UI gap)
        {
          path: 'inventory',
          component: () => import('../modules/inventory/views/InventoryView.vue'),
          meta: { requiresAuth: true, title: 'Inventory', resource: 'inventory' },
        },
        {
          path: 'inventory/movements',
          component: () => import('../modules/inventory/views/InventoryMovementsView.vue'),
          meta: { requiresAuth: true, title: 'Movement Ledger', resource: 'inventory' },
        },
        {
          path: 'customers/:id/soa',
          component: () => import('../modules/customers/views/CustomerSoaView.vue'),
          meta: { requiresAuth: true, title: 'Statement of Account', resource: 'customers' },
        },
        {
          path: 'customers/:id/credits',
          component: () => import('../modules/customers/views/CustomerCreditsView.vue'),
          meta: { requiresAuth: true, title: 'Customer Credit', resource: 'customers' },
        },
        {
          path: 'invoices',
          component: () => import('../modules/invoicing/views/InvoiceListView.vue'),
          meta: { requiresAuth: true, title: 'Invoices', resource: 'invoices' },
        },
        {
          path: 'invoices/new',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Invoice', resource: 'invoices' },
        },
        {
          path: 'invoices/:id',
          component: () => import('../modules/invoicing/views/InvoiceDetailView.vue'),
          meta: { requiresAuth: true, title: 'Invoice', resource: 'invoices' },
        },
        {
          path: 'invoices/:id/edit',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Invoice', resource: 'invoices' },
        },
        // Standalone credit-note UI (Phase 33, UPGRADE.md G-13/F-24 — the
        // API existed since Phase 6, this closes the missing-UI gap; the
        // SidebarNav link to /credit-notes was previously dead)
        {
          path: 'credit-notes',
          component: () => import('../modules/invoicing/views/CreditNoteListView.vue'),
          meta: { requiresAuth: true, title: 'Credit Notes', resource: 'invoices' },
        },
        {
          path: 'credit-notes/new',
          component: () => import('../modules/invoicing/views/CreditNoteEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Credit Note', resource: 'invoices' },
        },
        {
          path: 'credit-notes/:id',
          component: () => import('../modules/invoicing/views/CreditNoteDetailView.vue'),
          meta: { requiresAuth: true, title: 'Credit Note', resource: 'invoices' },
        },
        // Delivery notes / packing slips (Phase 33, UPGRADE.md G-13/F-24)
        {
          path: 'delivery-notes',
          component: () => import('../modules/invoicing/views/DeliveryNoteListView.vue'),
          meta: { requiresAuth: true, title: 'Delivery Notes', resource: 'invoices' },
        },
        {
          path: 'delivery-notes/:id',
          component: () => import('../modules/invoicing/views/DeliveryNoteDetailView.vue'),
          meta: { requiresAuth: true, title: 'Delivery Note', resource: 'invoices' },
        },
        // Estimates (Phase 25)
        {
          path: 'estimates',
          component: () => import('../modules/estimates/views/EstimateListView.vue'),
          meta: { requiresAuth: true, title: 'Estimates', resource: 'estimates' },
        },
        {
          path: 'estimates/new',
          component: () => import('../modules/estimates/views/EstimateEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Estimate', resource: 'estimates' },
        },
        {
          path: 'estimates/:id',
          component: () => import('../modules/estimates/views/EstimateDetailView.vue'),
          meta: { requiresAuth: true, title: 'Estimate', resource: 'estimates' },
        },
        {
          path: 'estimates/:id/edit',
          component: () => import('../modules/estimates/views/EstimateEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Estimate', resource: 'estimates' },
        },
        // Recurring invoices (Phase 26)
        {
          path: 'recurring',
          component: () => import('../modules/recurrence/views/RecurrenceListView.vue'),
          meta: { requiresAuth: true, title: 'Recurring Invoices', resource: 'recurring' },
        },
        {
          path: 'recurring/new',
          component: () => import('../modules/recurrence/views/RecurrenceEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Recurring Profile', resource: 'recurring' },
        },
        {
          path: 'recurring/:id',
          component: () => import('../modules/recurrence/views/RecurrenceDetailView.vue'),
          meta: { requiresAuth: true, title: 'Recurring Profile', resource: 'recurring' },
        },
        {
          path: 'recurring/:id/edit',
          component: () => import('../modules/recurrence/views/RecurrenceEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Recurring Profile', resource: 'recurring' },
        },
        // Bills
        {
          path: 'bills',
          component: () => import('../modules/purchases/views/BillListView.vue'),
          meta: { requiresAuth: true, title: 'Bills', resource: 'bills' },
        },
        {
          path: 'bills/soa-extract',
          component: () => import('../modules/purchases/views/SoaExtractView.vue'),
          meta: { requiresAuth: true, title: 'SOA Extraction', resource: 'bills' },
        },
        {
          path: 'bills/new',
          component: () => import('../modules/purchases/views/BillEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Bill', resource: 'bills' },
        },
        {
          path: 'bills/:id',
          component: () => import('../modules/purchases/views/BillDetailView.vue'),
          meta: { requiresAuth: true, title: 'Bill', resource: 'bills' },
        },
        {
          path: 'bills/:id/edit',
          component: () => import('../modules/purchases/views/BillEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Bill', resource: 'bills' },
        },
        // Expenses (Phase 31, UPGRADE.md G-11)
        {
          path: 'expenses',
          component: () => import('../modules/expenses/views/ExpensesView.vue'),
          meta: { requiresAuth: true, title: 'Expenses', resource: 'expenses' },
        },
        // Projects & time tracking (Phase 32, UPGRADE.md G-12)
        {
          path: 'projects',
          component: () => import('../modules/projects/views/ProjectsView.vue'),
          meta: { requiresAuth: true, title: 'Projects', resource: 'projects' },
        },
        {
          path: 'projects/:id',
          component: () => import('../modules/projects/views/ProjectDetailView.vue'),
          meta: { requiresAuth: true, title: 'Project', resource: 'projects' },
        },
        // Order lists (Phase 34)
        {
          path: 'order-lists',
          component: () => import('../modules/orderLists/views/OrderListsView.vue'),
          meta: { requiresAuth: true, title: 'Order Lists', resource: 'orders' },
        },
        {
          path: 'order-lists/:id',
          component: () => import('../modules/orderLists/views/OrderListDetailView.vue'),
          meta: { requiresAuth: true, title: 'Order List', resource: 'orders' },
        },
        // Purchase Orders
        {
          path: 'pos',
          component: () => import('../modules/po/views/PoListView.vue'),
          meta: { requiresAuth: true, title: 'Purchase Orders', resource: 'po' },
        },
        {
          path: 'pos/new',
          component: () => import('../modules/po/views/PoEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Purchase Order', resource: 'po' },
        },
        {
          path: 'pos/:id',
          component: () => import('../modules/po/views/PoDetailView.vue'),
          meta: { requiresAuth: true, title: 'Purchase Order', resource: 'po' },
        },
        {
          path: 'pos/:id/edit',
          component: () => import('../modules/po/views/PoEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Purchase Order', resource: 'po' },
        },
        // Supplier SOA
        {
          path: 'suppliers/:id/soa',
          component: () => import('../modules/suppliers/views/SupplierSoaView.vue'),
          meta: { requiresAuth: true, title: 'Supplier Statement', resource: 'suppliers' },
        },
        // GST
        {
          path: 'gst',
          component: () => import('../modules/gst/views/GstView.vue'),
          meta: { requiresAuth: true, title: 'GST', resource: 'gst' },
        },
        {
          path: 'gst/periods/:id',
          component: () => import('../modules/gst/views/GstReturnView.vue'),
          meta: { requiresAuth: true, title: 'GST Period', resource: 'gst' },
        },
        // Reports
        {
          path: 'reports',
          component: () => import('../modules/reports/views/ReportsHubView.vue'),
          meta: { requiresAuth: true, title: 'Reports', resource: 'reports' },
        },
        {
          path: 'reports/sales',
          component: () => import('../modules/reports/views/SalesReportView.vue'),
          meta: { requiresAuth: true, title: 'Sales Report', resource: 'reports' },
        },
        {
          path: 'reports/purchases',
          component: () => import('../modules/reports/views/PurchasesReportView.vue'),
          meta: { requiresAuth: true, title: 'Purchases Report', resource: 'reports' },
        },
        {
          path: 'reports/stock-valuation',
          component: () => import('../modules/reports/views/StockValuationReportView.vue'),
          meta: { requiresAuth: true, title: 'Stock Valuation', resource: 'reports' },
        },
        {
          path: 'reports/aged-receivables',
          component: () => import('../modules/reports/views/AgedReceivablesView.vue'),
          meta: { requiresAuth: true, title: 'Aged Receivables', resource: 'reports' },
        },
        {
          path: 'reports/aged-payables',
          component: () => import('../modules/reports/views/AgedPayablesView.vue'),
          meta: { requiresAuth: true, title: 'Aged Payables', resource: 'reports' },
        },
        {
          path: 'reports/gst-summary',
          component: () => import('../modules/reports/views/GstSummaryReportView.vue'),
          meta: { requiresAuth: true, title: 'GST Summary', resource: 'reports' },
        },
        // Admin (Phase 21)
        {
          path: 'users',
          component: () => import('../modules/users/views/UsersView.vue'),
          meta: { requiresAuth: true, requiresAdmin: true, title: 'Users' },
        },
        {
          path: 'audit',
          component: () => import('../modules/audit/views/AuditLogView.vue'),
          meta: { requiresAuth: true, requiresAdmin: true, title: 'Audit Log' },
        },
        // Settings (Phase 22)
        {
          path: 'settings',
          component: () => import('../modules/settings/views/SettingsView.vue'),
          meta: { requiresAuth: true, requiresAdmin: true, title: 'Settings' },
        },
        // Exchange rates (Phase 30, UPGRADE.md G-10)
        {
          path: 'settings/exchange-rates',
          component: () => import('../modules/settings/views/ExchangeRatesView.vue'),
          meta: { requiresAuth: true, requiresAdmin: true, title: 'Exchange Rates' },
        },
        // Custom fields (Phase 33c, UPGRADE.md G-13/F-24)
        {
          path: 'settings/custom-fields',
          component: () => import('../modules/settings/views/CustomFieldsSettingsView.vue'),
          meta: { requiresAuth: true, requiresAdmin: true, title: 'Custom Fields' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('../modules/auth/views/NotFoundView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  await authStore.bootstrap()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (to.meta.requiresAdmin && authStore.user?.role !== 'admin') {
    return { path: '/dashboard' }
  }

  // Phase 37 — a route with a declared resource 403s server-side for a
  // staff/manager user without view access; redirect before that round trip.
  // Only meaningful once the user is loaded (bootstrap() above resolves
  // before this point either way).
  if (
    to.meta.resource &&
    authStore.isAuthenticated &&
    !authStore.hasPermission(to.meta.resource, 'view')
  ) {
    return { path: '/dashboard' }
  }

  if (to.meta.public && authStore.isAuthenticated) {
    return { path: '/dashboard' }
  }
})

export default router
