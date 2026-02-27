/**
 * Question generation via Claude Edge Function.
 * Port of backend/services/question_generator.py
 */

import { supabase } from '../api/supabase'

interface GeneratedQuestion {
  question_type: string;
  difficulty_tier: string;
  question_text: string;
  answer_text: string;
  options: string[] | null;
  explanation: string;
}

export async function generateQuestionsForTopic(
  topicTitle: string,
  contentText: string,
  count: number = 7,
): Promise<GeneratedQuestion[]> {
  const { data, error } = await supabase.functions.invoke('claude-proxy', {
    body: {
      action: 'generate-questions',
      topic_title: topicTitle,
      content: contentText.slice(0, 6000),
      count,
    },
  })

  if (error) throw new Error(`Question generation failed: ${error.message}`)

  // Parse the response
  let responseText = typeof data === 'string' ? data : data.response || JSON.stringify(data)

  let jsonText = responseText.trim()
  if (jsonText.startsWith('```')) {
    const lines = jsonText.split('\n')
    jsonText = lines.slice(1, lines[lines.length - 1].trim() === '```' ? -1 : undefined).join('\n')
  }

  const parsed = JSON.parse(jsonText)
  const questions = parsed.questions || []

  // Validate and normalize
  const validTypes = new Set(['recall', 'conceptual', 'application', 'mcq', 'open_ended'])
  const validTiers = new Set(['foundational', 'intermediate', 'advanced'])

  const validQuestions: GeneratedQuestion[] = []

  for (const q of questions) {
    let qType = (q.question_type || '').toLowerCase()
    if (!validTypes.has(qType)) qType = 'conceptual'

    let tier = (q.difficulty_tier || '').toLowerCase()
    if (!validTiers.has(tier)) tier = 'intermediate'

    const questionText = (q.question || '').trim()
    const answerText = (q.answer || '').trim()

    if (!questionText || !answerText) continue

    let options = q.options
    if (qType === 'mcq' && (!options || options.length !== 4)) {
      qType = 'open_ended'
      options = null
    }

    validQuestions.push({
      question_type: qType,
      difficulty_tier: tier,
      question_text: questionText,
      answer_text: answerText,
      options: options || null,
      explanation: q.explanation || '',
    })
  }

  return validQuestions
}
