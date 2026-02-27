/**
 * AI-powered topic identification.
 * Port of backend/services/topic_identifier.py
 *
 * Sends numbered paragraphs to Claude via Edge Function,
 * gets back topic titles + paragraph indices, then extracts
 * the actual text from those paragraphs.
 */

import { supabase } from '../api/supabase'

function splitIntoParagraphs(text: string): string[] {
  let paragraphs: string[] = []
  for (const block of text.split('\n\n')) {
    const stripped = block.trim()
    if (stripped) paragraphs.push(stripped)
  }

  // If text has no double-newlines, fall back to single newlines
  if (paragraphs.length <= 1 && text.includes('\n')) {
    paragraphs = text.split('\n').map(l => l.trim()).filter(l => l)
  }

  return paragraphs
}

function formatNumberedParagraphs(paragraphs: string[], startIdx: number = 0): string {
  return paragraphs.map((para, i) => {
    const idx = startIdx + i
    const display = para.length <= 500 ? para : para.slice(0, 500) + '...'
    return `[${idx}] ${display}`
  }).join('\n\n')
}

function parseTopicResponse(
  responseText: string,
  allParagraphs: string[],
): { title: string; content_text: string }[] {
  let jsonText = responseText.trim()

  // Strip markdown code fences
  if (jsonText.startsWith('```')) {
    const lines = jsonText.split('\n')
    jsonText = lines.slice(1, lines[lines.length - 1].trim() === '```' ? -1 : undefined).join('\n')
  }

  const data = JSON.parse(jsonText)
  const topicsRaw = data.topics || []

  const results: { title: string; content_text: string }[] = []
  for (const t of topicsRaw) {
    const title = (t.title || '').trim()
    const paraIndices: number[] = t.paragraphs || []

    if (!title || !paraIndices.length) continue

    const contentParts: string[] = []
    for (const idx of paraIndices) {
      if (typeof idx === 'number' && idx >= 0 && idx < allParagraphs.length) {
        contentParts.push(allParagraphs[idx])
      }
    }

    const contentText = contentParts.join('\n\n')

    // Only keep topics with meaningful content (~20+ words)
    if (contentText.split(/\s+/).length >= 20) {
      results.push({ title, content_text: contentText })
    }
  }

  return results
}

export async function identifyTopics(fullText: string): Promise<{ title: string; content_text: string }[]> {
  const paragraphs = splitIntoParagraphs(fullText)

  if (paragraphs.length === 0) return []

  const allTopics: { title: string; content_text: string }[] = []
  const windowSize = 150
  const overlap = 10
  let start = 0

  while (start < paragraphs.length) {
    const end = Math.min(start + windowSize, paragraphs.length)
    const windowParas = paragraphs.slice(start, end)

    const numberedText = formatNumberedParagraphs(windowParas, start)

    const { data, error } = await supabase.functions.invoke('claude-proxy', {
      body: {
        action: 'identify-topics',
        text: numberedText,
      },
    })

    if (error) throw new Error(`Topic identification failed: ${error.message}`)

    try {
      const responseText = typeof data === 'string' ? data : data.response || JSON.stringify(data)
      const topics = parseTopicResponse(responseText, paragraphs)
      allTopics.push(...topics)
    } catch (e) {
      // Retry once with stricter prompt
      const { data: retryData, error: retryErr } = await supabase.functions.invoke('claude-proxy', {
        body: {
          action: 'identify-topics',
          text: numberedText,
          strict: true,
        },
      })

      if (retryErr) throw new Error(`Topic identification retry failed: ${retryErr.message}`)

      try {
        const retryText = typeof retryData === 'string' ? retryData : retryData.response || JSON.stringify(retryData)
        const topics = parseTopicResponse(retryText, paragraphs)
        allTopics.push(...topics)
      } catch {
        console.error('Failed to parse topic response on retry')
      }
    }

    if (end >= paragraphs.length) break
    start = end - overlap
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique: { title: string; content_text: string }[] = []
  for (const t of allTopics) {
    const normalized = t.title.toLowerCase().trim()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      unique.push(t)
    }
  }

  return unique
}
