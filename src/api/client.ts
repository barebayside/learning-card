import { supabase } from './supabase'
import { processGrade } from '../lib/scheduler'
import { evaluateMcq } from '../lib/answer-evaluator'

// ── Content / Import ──

export async function importFile(file: File) {
  // Client-side parsing — delegated to parsers module
  const { parseFile } = await import('../lib/parsers/index')

  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const supportedTypes = ['txt', 'json', 'docx', 'pdf']
  if (!supportedTypes.includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}. Supported: ${supportedTypes.join(', ')}`)
  }

  // SHA-256 hash for duplicate detection
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  // Check for duplicate
  const { data: existing } = await supabase
    .from('content_sources')
    .select('id')
    .eq('file_hash', fileHash)
    .maybeSingle()

  if (existing) {
    throw new Error('This file has already been imported (duplicate detected).')
  }

  // Parse file client-side
  const { text: rawText, images } = await parseFile(ext, bytes)

  if (!rawText.trim()) {
    throw new Error('No text content could be extracted from this file.')
  }

  const wordCount = rawText.split(/\s+/).length

  // Insert source record
  const { data: source, error } = await supabase
    .from('content_sources')
    .insert({
      filename: file.name,
      file_type: ext,
      file_hash: fileHash,
      file_size_bytes: file.size,
      raw_text: rawText,
      status: 'imported',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Upload extracted images to Supabase Storage
  let imageCount = 0
  if (images.size > 0) {
    for (const [filename, imgBytes] of images) {
      const ext = filename.split('.').pop() || 'png'
      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      const storagePath = `${source.id}/${filename}`

      const { error: uploadErr } = await supabase.storage
        .from('content-images')
        .upload(storagePath, imgBytes, { contentType, upsert: true })

      if (uploadErr) {
        console.warn(`Failed to upload image ${filename}:`, uploadErr.message)
      } else {
        imageCount++
      }
    }
  }

  return {
    source_id: source.id,
    filename: file.name,
    file_type: ext,
    word_count: wordCount,
    image_count: imageCount,
  }
}

export async function generateQuestions(
  sourceId: number,
  onStatus?: (message: string) => void,
): Promise<{ cards_generated: number; topics_found?: number; errors: { topic: string; error: string }[] }> {
  const { identifyTopics } = await import('../lib/topic-identifier')
  const { generateQuestionsForTopic } = await import('../lib/question-generator')

  onStatus?.('Loading source content...')

  // Get the source raw text
  const { data: source, error: srcErr } = await supabase
    .from('content_sources')
    .select('raw_text')
    .eq('id', sourceId)
    .single()

  if (srcErr || !source?.raw_text) throw new Error('Could not load source content')

  onStatus?.('Identifying topics with AI...')

  // Step 1: Identify topics via Edge Function
  const topics = await identifyTopics(source.raw_text)

  onStatus?.(`Found ${topics.length} topics. Generating questions...`)

  // Step 2: Save topics to DB
  const topicRecords = []
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i]
    const { data: topicRow, error: topicErr } = await supabase
      .from('topics')
      .insert({
        source_id: sourceId,
        title: t.title,
        topic_path: '',
        content_text: t.content_text,
        sequence_order: i,
        word_count: t.content_text.split(/\s+/).length,
      })
      .select('id, title, content_text')
      .single()

    if (topicErr) {
      console.error('Failed to insert topic:', topicErr)
      continue
    }
    topicRecords.push(topicRow)
  }

  // Step 3: Generate questions for each topic
  let totalCards = 0
  const errors: { topic: string; error: string }[] = []

  for (let i = 0; i < topicRecords.length; i++) {
    const topic = topicRecords[i]
    onStatus?.(`Topic ${i + 1}/${topicRecords.length}: "${topic.title}" (${totalCards} cards so far)`)

    try {
      const questions = await generateQuestionsForTopic(topic.title, topic.content_text)

      // Save cards to DB
      if (questions.length > 0) {
        const cardRows = questions.map(q => ({
          topic_id: topic.id,
          question_type: q.question_type,
          difficulty_tier: q.difficulty_tier,
          question_text: q.question_text,
          answer_text: q.answer_text,
          options_json: q.options ? JSON.stringify(q.options) : null,
          explanation: q.explanation || null,
        }))

        const { error: cardErr } = await supabase.from('cards').insert(cardRows)
        if (cardErr) {
          errors.push({ topic: topic.title, error: cardErr.message })
        } else {
          totalCards += questions.length
        }
      }
    } catch (e: any) {
      errors.push({ topic: topic.title, error: e.message })
      onStatus?.(`Error on "${topic.title}": ${e.message}`)
    }
  }

  // Update source status
  await supabase
    .from('content_sources')
    .update({ status: 'processed' })
    .eq('id', sourceId)

  return {
    cards_generated: totalCards,
    topics_found: topicRecords.length,
    errors,
  }
}

export async function getSources() {
  const { data, error } = await supabase
    .from('content_sources')
    .select('id, filename, file_type, status, error_message, import_date')
    .order('import_date', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

export async function getTopics(sourceId: number) {
  const { data, error } = await supabase
    .from('topics')
    .select('id, source_id, title, topic_path, content_text, sequence_order, word_count')
    .eq('source_id', sourceId)
    .order('sequence_order')

  if (error) throw new Error(error.message)
  return data || []
}

export async function deleteSource(sourceId: number) {
  const { error } = await supabase
    .from('content_sources')
    .delete()
    .eq('id', sourceId)

  if (error) throw new Error(error.message)
}

export async function getSourcesSummary() {
  const { data, error } = await supabase.rpc('get_sources_summary')
  if (error) throw new Error(error.message)
  return data || []
}

// ── Study ──

let currentSessionId: number | null = null
let sessionCardsStudied = 0
let sessionCardsCorrect = 0
let sessionTotalTimeMs = 0

export async function startStudySession(sourceId?: number, topicId?: number) {
  // Create session
  const { data: session, error: sessErr } = await supabase
    .from('study_sessions')
    .insert({ status: 'active' })
    .select('id')
    .single()

  if (sessErr) throw new Error(sessErr.message)
  currentSessionId = session.id
  sessionCardsStudied = 0
  sessionCardsCorrect = 0
  sessionTotalTimeMs = 0

  // Get cards: learning/relearning due → review due → new
  const now = new Date().toISOString()
  const limit = 20

  let cards: any[] = []

  // 1. Learning/relearning cards due now
  let query = supabase
    .from('cards')
    .select('*, topics(title, source_id, content_sources:source_id(filename))')
    .in('card_state', ['learning', 'relearning'])
    .eq('is_suspended', false)
    .lte('due_date', now)
    .limit(limit)

  if (topicId) query = query.eq('topic_id', topicId)
  else if (sourceId) query = query.eq('topics.source_id', sourceId)

  const { data: learningCards } = await query
  if (learningCards) cards.push(...learningCards)

  // 2. Review cards due
  let remaining = limit - cards.length
  if (remaining > 0) {
    let q2 = supabase
      .from('cards')
      .select('*, topics(title, source_id, content_sources:source_id(filename))')
      .eq('card_state', 'review')
      .eq('is_suspended', false)
      .lte('due_date', now)
      .limit(remaining)

    if (topicId) q2 = q2.eq('topic_id', topicId)
    else if (sourceId) q2 = q2.eq('topics.source_id', sourceId)

    const { data: dueCards } = await q2
    if (dueCards) cards.push(...dueCards)
  }

  // 3. New cards
  remaining = limit - cards.length
  if (remaining > 0) {
    let q3 = supabase
      .from('cards')
      .select('*, topics(title, source_id, content_sources:source_id(filename))')
      .eq('card_state', 'new')
      .eq('is_suspended', false)
      .limit(remaining)

    if (topicId) q3 = q3.eq('topic_id', topicId)
    else if (sourceId) q3 = q3.eq('topics.source_id', sourceId)

    const { data: newCards } = await q3
    if (newCards) cards.push(...newCards)
  }

  // Flatten the joined data
  const flatCards = cards.map(c => ({
    ...c,
    topic_title: c.topics?.title || 'Unknown Topic',
    source_id: c.topics?.source_id,
    source_filename: c.topics?.content_sources?.filename,
    topics: undefined,
  }))

  return {
    session_id: session.id,
    cards: flatCards,
    total_available: flatCards.length,
  }
}

export async function getTopicStats(sourceId: number) {
  const { data, error } = await supabase.rpc('get_topic_stats', { p_source_id: sourceId })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getCardsByTopic(topicId: number) {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('topic_id', topicId)
    .order('id')

  if (error) throw new Error(error.message)
  return data || []
}

export async function getStudyCards(limit: number = 20) {
  // Not used directly anymore — startStudySession handles card fetching
  return { cards: [], total_available: 0 }
}

export async function gradeCard(cardId: number, grade: number, timeTakenMs?: number) {
  // Get current card
  const { data: card, error: cardErr } = await supabase
    .from('cards')
    .select('card_state, ease_factor, step_index, interval_days')
    .eq('id', cardId)
    .single()

  if (cardErr || !card) throw new Error('Card not found')

  // Run scheduler
  const result = processGrade(card, grade)

  // Update card
  const { error: updateErr } = await supabase
    .from('cards')
    .update({
      card_state: result.card_state,
      ease_factor: result.ease_factor,
      interval_days: result.interval_days,
      step_index: result.step_index,
      due_date: result.due_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cardId)

  if (updateErr) throw new Error(updateErr.message)

  // Increment review count and lapse count if needed
  if (grade === 0 && card.card_state === 'review') {
    await supabase.rpc('increment_card_lapse', { p_card_id: cardId })
  }
  await supabase.rpc('increment_card_review', { p_card_id: cardId })

  // Record review history
  await supabase.from('review_history').insert({
    card_id: cardId,
    session_id: currentSessionId,
    grade,
    previous_interval: card.interval_days,
    new_interval: result.interval_days,
    previous_ease: card.ease_factor,
    new_ease: result.ease_factor,
    time_taken_ms: timeTakenMs || null,
  })

  // Update session stats
  sessionCardsStudied += 1
  if (grade >= 2) sessionCardsCorrect += 1
  if (timeTakenMs) sessionTotalTimeMs += timeTakenMs

  if (currentSessionId) {
    await supabase
      .from('study_sessions')
      .update({
        cards_studied: sessionCardsStudied,
        cards_correct: sessionCardsCorrect,
        total_time_ms: sessionTotalTimeMs,
      })
      .eq('id', currentSessionId)
  }

  return {
    card_id: cardId,
    new_state: result.card_state,
    new_interval: result.interval_days,
    new_ease: result.ease_factor,
    due_date: result.due_date,
  }
}

export async function endStudySession() {
  if (currentSessionId) {
    await supabase
      .from('study_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', currentSessionId)
    currentSessionId = null
  }
}

// ── Cards ──

export async function getAllCards() {
  const { data, error } = await supabase
    .from('cards')
    .select('*, topics(title, source_id, content_sources:source_id(filename))')
    .order('id')

  if (error) throw new Error(error.message)

  return (data || []).map(c => ({
    ...c,
    topic_title: c.topics?.title || 'Unknown Topic',
    source_id: c.topics?.source_id,
    source_filename: c.topics?.content_sources?.filename || 'Unknown',
    topics: undefined,
  }))
}

export async function getCardStats() {
  const { data, error } = await supabase.rpc('get_card_stats')
  if (error) throw new Error(error.message)
  return data
}

export async function getReports() {
  const { data, error } = await supabase.rpc('get_reports')
  if (error) throw new Error(error.message)
  return data
}

export async function suspendCard(cardId: number) {
  const { error } = await supabase
    .from('cards')
    .update({ is_suspended: true })
    .eq('id', cardId)

  if (error) throw new Error(error.message)
}

export async function unsuspendCard(cardId: number) {
  const { error } = await supabase
    .from('cards')
    .update({ is_suspended: false })
    .eq('id', cardId)

  if (error) throw new Error(error.message)
}

export async function deleteCard(cardId: number) {
  const { error } = await supabase
    .from('cards')
    .delete()
    .eq('id', cardId)

  if (error) throw new Error(error.message)
}

export async function rescheduleCard(cardId: number, intervalDays?: number, dueDate?: string) {
  const updates: any = {}
  if (dueDate) {
    updates.due_date = dueDate
  } else if (intervalDays !== undefined) {
    const due = new Date()
    due.setDate(due.getDate() + intervalDays)
    updates.due_date = due.toISOString()
    updates.interval_days = intervalDays
  }

  const { error } = await supabase
    .from('cards')
    .update(updates)
    .eq('id', cardId)

  if (error) throw new Error(error.message)
}

export async function updateCard(cardId: number, updates: Record<string, any>) {
  const { error } = await supabase
    .from('cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', cardId)

  if (error) throw new Error(error.message)
}

export async function mergeCards(cardIds: number[], mergedQuestion?: string, mergedAnswer?: string) {
  if (cardIds.length < 2) throw new Error('Need at least 2 cards to merge')

  const targetId = cardIds[0]
  const sourceIds = cardIds.slice(1)

  // Update target card with merged content
  if (mergedQuestion || mergedAnswer) {
    const updates: any = { updated_at: new Date().toISOString() }
    if (mergedQuestion) updates.question_text = mergedQuestion
    if (mergedAnswer) updates.answer_text = mergedAnswer

    await supabase.from('cards').update(updates).eq('id', targetId)
  }

  // Delete source cards
  for (const id of sourceIds) {
    await supabase.from('cards').delete().eq('id', id)
  }
}

export async function checkAnswer(cardId: number, userAnswer: string) {
  // Get the card
  const { data: card, error } = await supabase
    .from('cards')
    .select('question_type, question_text, answer_text')
    .eq('id', cardId)
    .single()

  if (error || !card) throw new Error('Card not found')

  if (!userAnswer.trim()) {
    return { correctness: 'incorrect' as const, feedback: 'No answer provided.', suggested_grade: 0 }
  }

  // MCQ: evaluate client-side
  if (card.question_type === 'mcq') {
    return evaluateMcq(card.answer_text, userAnswer)
  }

  // Free-text: call Edge Function
  const { data: result, error: fnErr } = await supabase.functions.invoke('claude-proxy', {
    body: {
      action: 'evaluate-answer',
      question_text: card.question_text,
      correct_answer: card.answer_text,
      user_answer: userAnswer,
    },
  })

  if (fnErr) throw new Error(fnErr.message)
  return result
}

// ── Tutor ──

export function streamTutorChat(
  message: string,
  conversationId: number = 0,
  cardId?: number,
  onToken: (token: string) => void = () => {},
  onDone: (convId: number) => void = () => {},
) {
  // Build the request — we need card context for the system prompt
  const body = {
    action: 'tutor-chat' as const,
    conversation_id: conversationId,
    card_id: cardId,
    message,
  }

  // First, get card context if we have a cardId
  const prepareAndStream = async () => {
    let systemPrompt = 'You are a patient, Socratic tutor. Help the student understand the material.'
    let conversationMessages: { role: string; content: string }[] = []
    let convId = conversationId

    if (cardId) {
      // Get card and topic context
      const { data: card } = await supabase
        .from('cards')
        .select('question_text, answer_text, explanation, topic_id')
        .eq('id', cardId)
        .single()

      if (card) {
        const { data: topic } = await supabase
          .from('topics')
          .select('title, content_text')
          .eq('id', card.topic_id)
          .single()

        const topicTitle = topic?.title || 'Unknown Topic'
        const explanation = card.explanation ? `Additional context: ${card.explanation}` : ''
        const sourceContent = topic?.content_text
          ? `\nStudent's original notes on this topic:\n---\n${topic.content_text.slice(0, 2000)}\n---`
          : ''

        systemPrompt = `You are a patient, Socratic tutor helping a student review their own study notes.

IMPORTANT — SOURCE-FIRST APPROACH:
- The student has uploaded their own notes/source material. The questions and answers are based on THAT material.
- When explaining concepts, START with what the student's own notes say. Reference and quote their source material.
- You CAN use general knowledge to clarify, give analogies, or explain WHY something works — but always ground it in their notes first.
- If the student asks "what do my notes say about X?", refer to the source material and correct answer.
- Never contradict what's in the student's notes. If their notes contain a simplification, work with it.

Your approach:
1. Guide the student to discover answers rather than giving them directly
2. Reference their own notes when explaining ("Your notes mention that...")
3. Use analogies and general knowledge to make the concept clearer when helpful
4. Celebrate correct reasoning, gently redirect incorrect reasoning
5. Keep responses concise (2-3 paragraphs max)
6. If the student is stuck, quote relevant parts from the source material as hints

CURRENT CONTEXT:
Topic: ${topicTitle}
Current question: ${card.question_text}
Correct answer (from their notes): ${card.answer_text}
${explanation}
${sourceContent}`
      }
    }

    // Get or create conversation
    if (convId === 0) {
      const topicId = cardId
        ? (await supabase.from('cards').select('topic_id').eq('id', cardId).single()).data?.topic_id
        : null

      const { data: conv } = await supabase
        .from('tutor_conversations')
        .insert({ card_id: cardId || null, topic_id: topicId })
        .select('id')
        .single()

      if (conv) convId = conv.id
    }

    // Save user message
    await supabase.from('tutor_messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message,
    })

    // Get conversation history
    const { data: history } = await supabase
      .from('tutor_messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .in('role', ['user', 'assistant'])
      .order('id')
      .limit(20)

    conversationMessages = history || []

    // Call Edge Function for streaming
    const { data: response, error: fnErr } = await supabase.functions.invoke('claude-proxy', {
      body: {
        action: 'tutor-chat',
        system_prompt: systemPrompt,
        messages: conversationMessages,
      },
    })

    if (fnErr) {
      onToken(`\n\n[Error: ${fnErr.message}]`)
      onDone(convId)
      return
    }

    // Handle streaming response
    if (response && typeof response === 'object' && response.content) {
      // Non-streaming fallback
      onToken(response.content)

      // Save assistant response
      await supabase.from('tutor_messages').insert({
        conversation_id: convId,
        role: 'assistant',
        content: response.content,
      })

      onDone(convId)
    } else if (typeof response === 'string') {
      onToken(response)
      await supabase.from('tutor_messages').insert({
        conversation_id: convId,
        role: 'assistant',
        content: response,
      })
      onDone(convId)
    }
  }

  prepareAndStream().catch(err => {
    onToken(`\n\n[Error: ${err.message}]`)
    onDone(conversationId)
  })
}

// ── Settings ──

export async function getSettings() {
  const { data, error } = await supabase
    .from('user_settings')
    .select('key, value')

  if (error) throw new Error(error.message)

  const settings: Record<string, any> = {}
  for (const row of data || []) {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      settings[row.key] = row.value
    }
  }
  return settings
}

export async function updateSetting(key: string, value: any) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      key,
      value: JSON.stringify(value),
      updated_at: new Date().toISOString(),
    })

  if (error) throw new Error(error.message)
}

// ── Images ──

export function getImageUrl(sourceId: number, filename: string): string {
  const { data } = supabase.storage
    .from('content-images')
    .getPublicUrl(`${sourceId}/${filename}`)

  return data.publicUrl
}
