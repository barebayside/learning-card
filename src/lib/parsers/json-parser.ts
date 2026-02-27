/**
 * JSON parser — extracts all text content from structured JSON.
 * Port of backend/services/parsers/json_parser.py
 */

export function parseJson(text: string): string {
  const data = JSON.parse(text)
  const parts: string[] = []

  function extractText(obj: any): void {
    if (typeof obj === 'string') {
      const stripped = obj.trim()
      if (stripped) parts.push(stripped)
    } else if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      // Pull known text fields
      for (const key of ['title', 'heading', 'topic', 'name']) {
        if (key in obj && typeof obj[key] === 'string' && obj[key].trim()) {
          parts.push(obj[key].trim())
        }
      }
      for (const key of ['content', 'text', 'body', 'description', 'summary']) {
        if (key in obj) {
          extractText(obj[key])
        }
      }
      // Recurse into list-valued fields
      for (const key of ['sections', 'chapters', 'topics', 'items', 'entries']) {
        if (key in obj && Array.isArray(obj[key])) {
          for (const item of obj[key]) {
            extractText(item)
          }
        }
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        extractText(item)
      }
    }
  }

  extractText(data)
  return parts.join('\n\n')
}
