import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'

// Our template functions return a plain React.ReactElement (react-pdf's own
// DocumentProps type isn't worth threading through every template's return
// type); renderToBuffer only cares that it's a <Document> element at runtime.
export async function renderPdfBuffer(element: ReactElement): Promise<Buffer> {
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0])
}
