import { parseTxt } from './txt-parser'
import { parseJson } from './json-parser'
import type { ParseResult } from '../../types'

export async function parseFile(fileType: string, bytes: Uint8Array): Promise<ParseResult> {
  switch (fileType) {
    case 'txt':
      return { text: parseTxt(new TextDecoder().decode(bytes)), images: new Map() }
    case 'json':
      return { text: parseJson(new TextDecoder().decode(bytes)), images: new Map() }
    case 'pdf': {
      const { parsePdf } = await import('./pdf-parser')
      return parsePdf(bytes)
    }
    case 'docx': {
      const { parseDocx } = await import('./docx-parser')
      return parseDocx(bytes)
    }
    default:
      throw new Error(`No parser for file type: ${fileType}`)
  }
}
