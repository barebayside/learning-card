/**
 * DOCX parser using mammoth for client-side text extraction.
 */

export async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')

  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer as ArrayBuffer,
  })

  return result.value.trim()
}
