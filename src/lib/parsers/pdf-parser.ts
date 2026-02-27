/**
 * PDF parser using pdfjs-dist for client-side text extraction.
 */

export async function parsePdf(bytes: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')

  // Set the worker source
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

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

  return pages.join('\n\n')
}
