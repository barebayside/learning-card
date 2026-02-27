/**
 * DOCX parser using mammoth for client-side text + image extraction.
 * Uses convertToHtml with a custom convertImage callback to capture
 * embedded images, then converts HTML to plain text with [IMAGE:] markers.
 */

import type { ParseResult } from '../../types'

export async function parseDocx(bytes: Uint8Array): Promise<ParseResult> {
  const mammoth = await import('mammoth')

  const images = new Map<string, Uint8Array>()
  let imageIndex = 0

  const result = await mammoth.convertToHtml(
    { arrayBuffer: bytes.buffer as ArrayBuffer },
    {
      convertImage: mammoth.images.imgElement(function (image: any) {
        imageIndex++
        const ext = (image.contentType || 'image/png').split('/')[1] || 'png'
        const filename = `img_${String(imageIndex).padStart(3, '0')}.${ext}`

        return image.read('base64').then(function (base64Data: string) {
          // Decode base64 to Uint8Array
          const binaryString = atob(base64Data)
          const imgBytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            imgBytes[i] = binaryString.charCodeAt(i)
          }
          images.set(filename, imgBytes)

          // Return an img element with a marker src so we can find it later
          return { src: `__IMAGE__${filename}__` }
        })
      }),
    },
  )

  // Convert HTML to plain text, replacing <img> tags with [IMAGE:filename] markers
  const text = htmlToTextWithMarkers(result.value)

  return { text: text.trim(), images }
}

function htmlToTextWithMarkers(html: string): string {
  // Replace <img> tags that have our marker src with [IMAGE:filename]
  let text = html.replace(
    /<img\s+[^>]*src="__IMAGE__([\w._-]+)__"[^>]*\/?>/gi,
    '\n[IMAGE:$1]\n',
  )

  // Block-level elements → newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/tr>/gi, '\n')
  text = text.replace(/<\/td>/gi, '\t')
  text = text.replace(/<li>/gi, '• ')

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')

  // Clean up excessive whitespace (but preserve [IMAGE:] on own lines)
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')

  return text
}
