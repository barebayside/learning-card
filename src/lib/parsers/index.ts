import { parseTxt } from './txt-parser'
import { parseJson } from './json-parser'

export async function parseFile(fileType: string, bytes: Uint8Array): Promise<string> {
  switch (fileType) {
    case 'txt':
      return parseTxt(new TextDecoder().decode(bytes))
    case 'json':
      return parseJson(new TextDecoder().decode(bytes))
    case 'pdf':
      const { parsePdf } = await import('./pdf-parser')
      return parsePdf(bytes)
    case 'docx':
      const { parseDocx } = await import('./docx-parser')
      return parseDocx(bytes)
    default:
      throw new Error(`No parser for file type: ${fileType}`)
  }
}
