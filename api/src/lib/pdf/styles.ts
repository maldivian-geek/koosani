import { StyleSheet } from '@react-pdf/renderer'

// Shared across every document template (Phase 23, UPGRADE.md Part 3).
// Plain, print-friendly — matches DESIGN.md §1's "functional, dense,
// professional" tone rather than trying to reproduce the web app's theme.
export const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  logo: {
    width: 100,
    maxHeight: 60,
    objectFit: 'contain',
    marginBottom: 8,
  },
  businessName: {
    fontSize: 13,
    fontWeight: 700,
  },
  muted: {
    color: '#666666',
  },
  titleBlock: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  section: {
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 8,
    color: '#666666',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  billToRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  table: {
    marginTop: 12,
    borderTop: '1pt solid #dddddd',
    borderBottom: '1pt solid #dddddd',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #eeeeee',
    paddingVertical: 6,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    backgroundColor: '#f5f5f5',
    fontWeight: 700,
  },
  colDescription: { flex: 3 },
  colQty: { flex: 1, textAlign: 'right' },
  colRate: { flex: 1, textAlign: 'right' },
  colGst: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1.2, textAlign: 'right' },
  totalsBlock: {
    marginTop: 16,
    alignSelf: 'flex-end',
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsRowFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderTop: '1pt solid #1a1a1a',
    marginTop: 3,
    fontWeight: 700,
    fontSize: 10,
  },
  notes: {
    marginTop: 28,
    paddingTop: 12,
    borderTop: '0.5pt solid #dddddd',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#999999',
    textAlign: 'center',
  },
})

export function formatMoney(v: string): string {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
