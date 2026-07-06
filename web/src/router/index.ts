import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    public?: boolean
    title?: string
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
          meta: { requiresAuth: true, title: 'Customers' },
        },
        {
          path: 'suppliers',
          component: () => import('../modules/suppliers/views/SuppliersView.vue'),
          meta: { requiresAuth: true, title: 'Suppliers' },
        },
        {
          path: 'items',
          component: () => import('../modules/items/views/ItemsView.vue'),
          meta: { requiresAuth: true, title: 'Items' },
        },
        {
          path: 'customers/:id/soa',
          component: () => import('../modules/customers/views/CustomerSoaView.vue'),
          meta: { requiresAuth: true, title: 'Statement of Account' },
        },
        {
          path: 'invoices',
          component: () => import('../modules/invoicing/views/InvoiceListView.vue'),
          meta: { requiresAuth: true, title: 'Invoices' },
        },
        {
          path: 'invoices/new',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Invoice' },
        },
        {
          path: 'invoices/:id',
          component: () => import('../modules/invoicing/views/InvoiceDetailView.vue'),
          meta: { requiresAuth: true, title: 'Invoice' },
        },
        {
          path: 'invoices/:id/edit',
          component: () => import('../modules/invoicing/views/InvoiceEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Invoice' },
        },
        // Bills
        {
          path: 'bills',
          component: () => import('../modules/purchases/views/BillListView.vue'),
          meta: { requiresAuth: true, title: 'Bills' },
        },
        {
          path: 'bills/soa-extract',
          component: () => import('../modules/purchases/views/SoaExtractView.vue'),
          meta: { requiresAuth: true, title: 'SOA Extraction' },
        },
        {
          path: 'bills/new',
          component: () => import('../modules/purchases/views/BillEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Bill' },
        },
        {
          path: 'bills/:id',
          component: () => import('../modules/purchases/views/BillDetailView.vue'),
          meta: { requiresAuth: true, title: 'Bill' },
        },
        {
          path: 'bills/:id/edit',
          component: () => import('../modules/purchases/views/BillEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Bill' },
        },
        // Purchase Orders
        {
          path: 'pos',
          component: () => import('../modules/po/views/PoListView.vue'),
          meta: { requiresAuth: true, title: 'Purchase Orders' },
        },
        {
          path: 'pos/new',
          component: () => import('../modules/po/views/PoEditorView.vue'),
          meta: { requiresAuth: true, title: 'New Purchase Order' },
        },
        {
          path: 'pos/:id',
          component: () => import('../modules/po/views/PoDetailView.vue'),
          meta: { requiresAuth: true, title: 'Purchase Order' },
        },
        {
          path: 'pos/:id/edit',
          component: () => import('../modules/po/views/PoEditorView.vue'),
          meta: { requiresAuth: true, title: 'Edit Purchase Order' },
        },
        // Supplier SOA
        {
          path: 'suppliers/:id/soa',
          component: () => import('../modules/suppliers/views/SupplierSoaView.vue'),
          meta: { requiresAuth: true, title: 'Supplier Statement' },
        },
        // GST
        {
          path: 'gst',
          component: () => import('../modules/gst/views/GstView.vue'),
          meta: { requiresAuth: true, title: 'GST' },
        },
        {
          path: 'gst/periods/:id',
          component: () => import('../modules/gst/views/GstReturnView.vue'),
          meta: { requiresAuth: true, title: 'GST Period' },
        },
        // Reports
        {
          path: 'reports',
          component: () => import('../modules/reports/views/ReportsHubView.vue'),
          meta: { requiresAuth: true, title: 'Reports' },
        },
        {
          path: 'reports/sales',
          component: () => import('../modules/reports/views/SalesReportView.vue'),
          meta: { requiresAuth: true, title: 'Sales Report' },
        },
        {
          path: 'reports/purchases',
          component: () => import('../modules/reports/views/PurchasesReportView.vue'),
          meta: { requiresAuth: true, title: 'Purchases Report' },
        },
        {
          path: 'reports/stock-valuation',
          component: () => import('../modules/reports/views/StockValuationReportView.vue'),
          meta: { requiresAuth: true, title: 'Stock Valuation' },
        },
        {
          path: 'reports/aged-receivables',
          component: () => import('../modules/reports/views/AgedReceivablesView.vue'),
          meta: { requiresAuth: true, title: 'Aged Receivables' },
        },
        {
          path: 'reports/aged-payables',
          component: () => import('../modules/reports/views/AgedPayablesView.vue'),
          meta: { requiresAuth: true, title: 'Aged Payables' },
        },
        {
          path: 'reports/gst-summary',
          component: () => import('../modules/reports/views/GstSummaryReportView.vue'),
          meta: { requiresAuth: true, title: 'GST Summary' },
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

  if (to.meta.public && authStore.isAuthenticated) {
    return { path: '/dashboard' }
  }
})

export default router
