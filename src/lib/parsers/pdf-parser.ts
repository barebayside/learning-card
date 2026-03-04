/**
 * PDF parser using pdfjs-dist for client-side text extraction,
 * with a Claude API fallback if pdfjs fails (e.g. unsupported encodings).
 */

import * as pdfjsLib from 'pdfjs-dist'
import type { ParseResult } from '../../types'

// Use Vite's ?url import to get the worker file path
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Remove control chars and fix broken unicode escape sequences */
function sanitizeText(text: string): string {
  return text
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
}

/** Primary parser: pdfjs-dist with per-page error handling */
async function parsePdfWithPdfjs(bytes: Uint8Array): Promise<string | null> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const pages: string[] = []
  let errorPages = 0

  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
      if (pageText.trim()) {
        pages.push(sanitizeText(pageText.trim()))
      }
    } catch (pageErr) {
      console.warn(`PDF parser: skipping page ${i} due to error:`, pageErr)
      errorPages++
    }
  }

  if (pages.length === 0) return null
  if (errorPages > 0) {
    console.warn(`PDF parser: ${errorPages}/${pdf.numPages} pages had errors`)
  }
  return pages.join('\n\n')
}

/** Fallback parser: send PDF to Claude via edge function for text extraction */
async function parsePdfWithClaude(bytes: Uint8Array): Promise<string> {
  const { supabase } = await import('../../api/supabase')

  // Convert to base64
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  const base64 = btoa(binary)

  const { data, error } = await supabase.functions.invoke('claude-proxy', {
    body: {
      action: 'extract-pdf-text',
      pdf_base64: base64,
    },
  })

  if (error) throw new Error(`Claude PDF extraction failed: ${error.message}`)
  if (!data?.text) throw new Error('Claude returned no text from PDF')

  return data.text
}

export async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  // Try pdfjs first
  try {
    const text = await parsePdfWithPdfjs(bytes)
    if (text) {
      return { text, images: new Map() }
    }
  } catch (err) {
    console.warn('PDF parser (pdfjs) failed entirely, falling back to Claude:', err)
  }

  // Fallback: let Claude read the PDF directly
  console.log('Using Claude API fallback for PDF text extraction')
  const text = await parsePdfWithClaude(bytes)
  return { text: sanitizeText(text), images: new Map() }
}
