/**
 * PDF parser using pdfjs-dist for client-side text extraction.
 */

import * as pdfjsLib from 'pdfjs-dist'
import type { ParseResult } from '../../types'

// Use Vite's ?url import to get the worker file path
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
    if (pageText.trim()) {
      pages.push(pageText.trim())
    }
  }

  return { text: pages.join('\n\n'), images: new Map() }
}
