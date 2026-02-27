import "https://deno.land/x/xhr@0.3.0/mod.ts"

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Prompts ──

const TOPIC_SYSTEM_PROMPT = `You are an expert at analyzing study notes and educational content. Your job is to read numbered paragraphs from the user's notes and identify the distinct topics covered, grouping related paragraphs together.

CRITICAL RULES:
- You are working ONLY with the user's source material. Do NOT add any outside knowledge.
- Group paragraphs by topic — nearby paragraphs about the same concept belong together.
- A paragraph can belong to only ONE topic.
- Every paragraph must be assigned to a topic (don't skip any).

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.`

const TOPIC_USER_TEMPLATE = `Below are numbered paragraphs from someone's study notes. Read them carefully and group them into distinct topics.

Rules:
- Each topic should be a coherent, self-contained unit of knowledge (something worth studying)
- Merge closely related sub-points into one topic rather than splitting them too finely
- A good topic has enough substance to generate 3-7 study questions
- Aim for topics that cover roughly 5-30 paragraphs each
- Every paragraph index must appear in exactly one topic
- Use short, descriptive titles that capture the subject matter

PARAGRAPHS:
{text}

Respond with this exact JSON structure (paragraph numbers only, do NOT copy any text):
{
  "topics": [
    {
      "title": "Short descriptive title",
      "paragraphs": [0, 1, 2, 3]
    }
  ]
}`

const QUESTION_SYSTEM_PROMPT = `You are creating study questions from the user's own notes and source material.

CRITICAL RULES:
- Every question and answer must be based ONLY on what is stated in the provided content.
- Do NOT add outside knowledge, facts, or context that isn't in the source material.
- Focus on testing UNDERSTANDING of concepts, relationships, and principles — not memorisation of trivial details.
- Do NOT create questions about specific URLs, website names, tool names, dates, or minor details UNLESS they are central to understanding a core concept.
- Every question should test something the student would genuinely benefit from knowing in a real-world context.
- Focus on WHY things work, HOW concepts relate to each other, and WHEN to apply different strategies or frameworks.
- Answers must first state the correct answer, then include a "Source:" reference quoting the relevant part of the notes.
- The source material may reference images, diagrams, charts, or figures that are NOT visible to the student.
  Do NOT create questions whose answers depend on seeing a visual element.
  If text says "as shown in the diagram", "the green line shows...", "refer to the chart", etc., skip that content
  UNLESS the text ALSO explains the concept fully in words without needing the visual.

BAD question examples (do NOT generate these):
- "According to your notes, what does tradingview.com offer?" (trivial tool name recall)
- "What date was X published?" (date memorisation)
- "Name the specific website mentioned for Y" (URL recall)
- "What is the exact number mentioned on page X?" (number trivia)
- "What does the green line represent in the chart?" (requires seeing an image that is not available)
- "According to the diagram, what happens when...?" (image-dependent)

GOOD question examples:
- "What are the key tools and resources available for market analysis, and what role does each serve?" (conceptual grouping)
- "Why is it important to use multiple analysis tools rather than relying on a single source?" (reasoning)
- "How does the concept of X relate to Y when making trading decisions?" (relationship understanding)
- "In what situation would you apply strategy X instead of strategy Y?" (practical application)

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON structure.`

const QUESTION_USER_TEMPLATE = `Generate {count} study questions based ONLY on the following source material.

SOURCE MATERIAL:
---
{content}
---

TOPIC: {topic_title}

Generate a mix of these question types:
- recall: Core principles, definitions, and key frameworks from the notes
- conceptual: Understanding relationships, cause-effect chains, and comparisons
- mcq: Multiple choice testing conceptual understanding with 4 options (A-D)
- open_ended: Scenario-based application questions

Difficulty levels:
- foundational: Core definitions, key principles, fundamental "what" and "why"
- intermediate: Relationships between concepts, cause-effect, comparing approaches
- advanced: Applying frameworks to new scenarios, evaluating trade-offs, synthesis

ANSWER FORMAT — Every answer MUST have two parts:
1. The correct answer (stated clearly, focusing on understanding)
2. Source: A direct quote or close reference from the source material

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "questions": [
    {
      "question_type": "recall|conceptual|mcq|open_ended",
      "difficulty_tier": "foundational|intermediate|advanced",
      "question": "The question text",
      "answer": "The correct answer. Source: 'quote from source material'",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "explanation": "Brief explanation of WHY this is the answer"
    }
  ]
}

For non-MCQ questions, set "options" to null.
Generate roughly: 1 recall, 3 conceptual, 2 MCQ, 1 open_ended questions.
Mix difficulty levels: 2 foundational, 3 intermediate, 2 advanced.`

const EVAL_SYSTEM_PROMPT = `You are evaluating a student's answer to a study question.

Compare their answer to the correct answer and assess whether they demonstrate understanding of the concept.

IMPORTANT:
- Focus on CONCEPTUAL understanding, not exact wording.
- A student who explains the concept correctly in their own words should be graded well.
- Minor details missed are acceptable if the core concept is understood.
- If the answer is partially correct, acknowledge what they got right and what's missing.

You MUST respond with valid JSON only:
{
  "correctness": "correct|partial|incorrect",
  "feedback": "Brief explanation of what was right, wrong, or missing (1-2 sentences)",
  "suggested_grade": 2
}

Grade mapping:
- 0 (Again): Completely wrong, no understanding shown, or blank/irrelevant answer
- 1 (Hard): Some understanding but significant gaps or key errors
- 2 (Good): Substantially correct, demonstrates solid understanding
- 3 (Easy): Excellent answer, clearly mastered this concept`

// ── Helpers ──

async function callClaude(
  system: string,
  userMessage: string,
  model: string = 'claude-sonnet-4-20250514',
  maxTokens: number = 4096,
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.content[0].text
}

async function callClaudeConversation(
  system: string,
  messages: { role: string; content: string }[],
  maxTokens: number = 1024,
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.content[0].text
}

// ── Main Handler ──

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'identify-topics': {
        const { text, strict } = body
        let userPrompt = TOPIC_USER_TEMPLATE.replace('{text}', text)
        if (strict) {
          userPrompt += '\n\nIMPORTANT: Respond with ONLY valid JSON. No text before or after the JSON.'
        }

        const response = await callClaude(TOPIC_SYSTEM_PROMPT, userPrompt, 'claude-sonnet-4-20250514', 4096)
        return new Response(JSON.stringify({ response }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      case 'generate-questions': {
        const { topic_title, content, count } = body
        const userPrompt = QUESTION_USER_TEMPLATE
          .replace('{count}', String(count || 7))
          .replace('{content}', content)
          .replace('{topic_title}', topic_title)

        const response = await callClaude(QUESTION_SYSTEM_PROMPT, userPrompt, 'claude-haiku-4-5-20251001', 4096)
        return new Response(JSON.stringify({ response }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      case 'evaluate-answer': {
        const { question_text, correct_answer, user_answer } = body
        const userPrompt = `Question: ${question_text}\n\nCorrect answer: ${correct_answer}\n\nStudent's answer: ${user_answer}\n\nEvaluate the student's understanding. Remember: focus on whether they understand the concept, not whether they used the exact same words.`

        const response = await callClaude(EVAL_SYSTEM_PROMPT, userPrompt, 'claude-haiku-4-5-20251001', 512)

        // Parse the JSON response
        let jsonText = response.trim()
        if (jsonText.startsWith('```')) {
          const lines = jsonText.split('\n')
          jsonText = lines.slice(1, lines[lines.length - 1].trim() === '```' ? -1 : undefined).join('\n')
        }

        const result = JSON.parse(jsonText)
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      case 'tutor-chat': {
        const { system_prompt, messages } = body
        const response = await callClaudeConversation(system_prompt, messages, 1024)
        return new Response(JSON.stringify({ content: response }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
