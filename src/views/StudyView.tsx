import { useState, useEffect, useCallback, useRef } from 'react'
import { startStudySession, gradeCard, endStudySession, getSourcesSummary, getTopicStats, checkAnswer, getCardsByTopic, updateCard, mergeCards, getImageUrl } from '../api/client'
import TutorSidebar from '../components/TutorSidebar'
import type { Card } from '../types'

const INTERVAL_LABELS = ['Day 0', 'Day 1', 'Day 4', 'Day 10', 'Day 25', 'Day 60', 'Day 150', 'Day 365'];

interface SourceSummary {
  source_id: number;
  filename: string;
  card_count: number;
  due_count: number;
  new_count: number;
  learning_count: number;
}

interface TopicStat {
  topic_id: number;
  topic_title: string;
  card_count: number;
  due_count: number;
  new_count: number;
  learning_count: number;
}

interface CheckResult {
  correctness: 'correct' | 'partial' | 'incorrect';
  feedback: string;
  suggested_grade: number;
}

const IMAGE_MARKER_RE = /\[IMAGE:([\w._-]+)\]/g

function renderTextWithImages(text: string, sourceId?: number): React.ReactNode {
  if (!sourceId || !text.includes('[IMAGE:')) {
    return text
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  IMAGE_MARKER_RE.lastIndex = 0

  while ((match = IMAGE_MARKER_RE.exec(text)) !== null) {
    // Add text before the marker
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const filename = match[1]
    parts.push(
      <img
        key={`img-${match.index}`}
        src={getImageUrl(sourceId, filename)}
        alt={`Diagram: ${filename}`}
        className="card-inline-image"
        loading="lazy"
      />
    )

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

export default function StudyView() {
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [selectedSource, setSelectedSource] = useState<number | undefined>(undefined)
  const [expandedSource, setExpandedSource] = useState<number | null>(null)
  const [topicStats, setTopicStats] = useState<Record<number, TopicStat[]>>({})
  const [loadingTopics, setLoadingTopics] = useState<number | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [cardsStudied, setCardsStudied] = useState(0)
  const [cardsCorrect, setCardsCorrect] = useState(0)
  const [showTutor, setShowTutor] = useState(false)
  const [error, setError] = useState('')
  const [cardStartTime, setCardStartTime] = useState(0)
  const [picking, setPicking] = useState(true)

  // Answer input state
  const [userAnswer, setUserAnswer] = useState('')
  const [isChecking, setIsChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [selectedMcqOption, setSelectedMcqOption] = useState<string | null>(null)
  const [scheduleFeedback, setScheduleFeedback] = useState('')

  // Edit & context panel state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editExplanation, setEditExplanation] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [showContextPanel, setShowContextPanel] = useState(false)
  const [topicCards, setTopicCards] = useState<Card[]>([])
  const [loadingContext, setLoadingContext] = useState(false)
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([])
  const [merging, setMerging] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    loadSources()
  }, [])

  async function loadSources() {
    try {
      const data = await getSourcesSummary()
      setSources(data)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function toggleSourceExpand(sourceId: number) {
    if (expandedSource === sourceId) {
      setExpandedSource(null)
      return
    }
    setExpandedSource(sourceId)
    if (!topicStats[sourceId]) {
      setLoadingTopics(sourceId)
      try {
        const stats = await getTopicStats(sourceId)
        setTopicStats((prev) => ({ ...prev, [sourceId]: stats }))
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoadingTopics(null)
      }
    }
  }

  async function startSession(sourceId?: number, topicId?: number) {
    setError('')
    try {
      const session = await startStudySession(sourceId, topicId)
      setCards(session.cards || [])
      setCurrentIndex(0)
      resetCardState()
      setSessionActive(true)
      setSessionComplete(false)
      setPicking(false)
      setCardsStudied(0)
      setCardsCorrect(0)
      setCardStartTime(Date.now())
    } catch (e: any) {
      setError(e.message)
    }
  }

  function resetCardState() {
    setShowAnswer(false)
    setUserAnswer('')
    setCheckResult(null)
    setSelectedMcqOption(null)
    setScheduleFeedback('')
    setIsChecking(false)
    setInterimTranscript('')
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
  }

  const handleGrade = useCallback(async (grade: number) => {
    const card = cards[currentIndex]
    if (!card) return

    const timeTaken = Date.now() - cardStartTime

    try {
      const result = await gradeCard(card.id, grade, timeTaken)
      setCardsStudied((prev) => prev + 1)
      if (grade >= 2) setCardsCorrect((prev) => prev + 1)

      // Show schedule feedback briefly
      if (result?.due_date) {
        const due = new Date(result.due_date)
        const now = new Date()
        const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        const label = diffDays <= 0 ? 'later today' : diffDays === 1 ? 'tomorrow' : `in ${diffDays} days`
        setScheduleFeedback(`Next review: ${label}`)
      }

      // Advance after brief delay to show feedback
      setTimeout(() => {
        if (currentIndex + 1 < cards.length) {
          setCurrentIndex((prev) => prev + 1)
          resetCardState()
          setCardStartTime(Date.now())
        } else {
          setSessionComplete(true)
          setSessionActive(false)
          endStudySession()
        }
      }, 800)
    } catch (e: any) {
      setError(e.message)
    }
  }, [cards, currentIndex, cardStartTime])

  async function handleCheckAnswer() {
    const card = cards[currentIndex]
    if (!card || !userAnswer.trim()) return

    setIsChecking(true)
    try {
      const result = await checkAnswer(card.id, userAnswer)
      setCheckResult(result as CheckResult)
      setShowAnswer(true)
    } catch (e: any) {
      setError(e.message)
      // Still show the answer even if check fails
      setShowAnswer(true)
    } finally {
      setIsChecking(false)
    }
  }

  async function handleMcqSelect(option: string) {
    const card = cards[currentIndex]
    if (!card || selectedMcqOption) return // already selected

    setSelectedMcqOption(option)
    setIsChecking(true)
    try {
      const result = await checkAnswer(card.id, option)
      setCheckResult(result as CheckResult)
      setShowAnswer(true)
    } catch (e: any) {
      setError(e.message)
      setShowAnswer(true)
    } finally {
      setIsChecking(false)
    }
  }

  function startListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input not supported in this browser. Try Chrome or Edge.')
      return
    }

    setError('')
    setInterimTranscript('')

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }

      // Commit final results to the answer field
      if (finalText) {
        setUserAnswer((prev) => {
          // Only append if we haven't already added this text
          const trimmedPrev = prev.trim()
          const trimmedFinal = finalText.trim()
          if (trimmedPrev && !trimmedPrev.endsWith(trimmedFinal)) {
            return trimmedPrev + ' ' + trimmedFinal
          }
          return trimmedFinal || trimmedPrev
        })
      }

      // Show interim (in-progress) transcript as live preview
      setInterimTranscript(interimText)
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
      recognitionRef.current = null
    }

    recognition.onerror = (event: any) => {
      setIsListening(false)
      setInterimTranscript('')
      recognitionRef.current = null
      const errorMap: Record<string, string> = {
        'not-allowed': 'Microphone access denied. Please allow microphone access in your browser settings.',
        'no-speech': 'No speech detected. Please try again.',
        'audio-capture': 'No microphone found. Please connect a microphone.',
        'network': 'Network error during voice recognition.',
      }
      setError(errorMap[event.error] || `Voice input error: ${event.error}`)
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setIsListening(false)
    setInterimTranscript('')
  }

  // --- Edit & context functions ---
  function openEditModal() {
    const card = cards[currentIndex]
    if (!card) return
    setEditQuestion(card.question_text)
    setEditAnswer(card.answer_text)
    setEditExplanation(card.explanation || '')
    setShowEditModal(true)
  }

  async function saveCardEdit() {
    const card = cards[currentIndex]
    if (!card) return
    setEditSaving(true)
    try {
      await updateCard(card.id, {
        question_text: editQuestion,
        answer_text: editAnswer,
        explanation: editExplanation || null,
      })
      // Update local card state
      setCards((prev) => {
        const updated = [...prev]
        updated[currentIndex] = {
          ...updated[currentIndex],
          question_text: editQuestion,
          answer_text: editAnswer,
          explanation: editExplanation || null,
        }
        return updated
      })
      setShowEditModal(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function openContextPanel() {
    const card = cards[currentIndex]
    if (!card) return
    setShowContextPanel(true)
    setSelectedForMerge([])
    setLoadingContext(true)
    try {
      const siblings = await getCardsByTopic(card.topic_id)
      setTopicCards(siblings)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingContext(false)
    }
  }

  function toggleMergeSelect(cardId: number) {
    setSelectedForMerge((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    )
  }

  async function handleMerge() {
    const card = cards[currentIndex]
    if (!card || selectedForMerge.length === 0) return
    // Current card + selected cards
    const mergeIds = [card.id, ...selectedForMerge]
    setMerging(true)
    try {
      await mergeCards(mergeIds)
      // Refresh the current card data after merge
      const siblings = await getCardsByTopic(card.topic_id)
      setTopicCards(siblings)
      // Update the current card in session with merged content
      const mergedCard = siblings.find((c: any) => c.id === card.id)
      if (mergedCard) {
        setCards((prev) => {
          const updated = [...prev]
          updated[currentIndex] = { ...updated[currentIndex], ...mergedCard }
          return updated
        })
      }
      // Remove merged-away cards from the session queue
      setCards((prev) => prev.filter((c) => !selectedForMerge.includes(c.id)))
      setSelectedForMerge([])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setMerging(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof HTMLInputElement) return
      if (!sessionActive) return

      if (e.code === 'Space' && !showAnswer && !checkResult) {
        e.preventDefault()
        setShowAnswer(true)
      } else if (showAnswer && checkResult) {
        if (e.key === '1') handleGrade(0)
        else if (e.key === '2') handleGrade(1)
        else if (e.key === '3') handleGrade(2)
        else if (e.key === '4') handleGrade(3)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showAnswer, sessionActive, handleGrade, checkResult])

  // --- Topic picker screen ---
  if (picking) {
    const hasAnyCards = sources.some((s) => s.card_count > 0)
    return (
      <div className="study-view">
        <h1>Study</h1>
        {error && <div className="error-msg">{error}</div>}

        {!hasAnyCards ? (
          <div className="empty-state">
            <h3>No cards yet</h3>
            <p>Import content and generate questions first.</p>
          </div>
        ) : (
          <>
            <p style={{ color: '#9898b0', marginBottom: '16px' }}>
              Choose a subject to study, or study everything at once.
            </p>

            <button
              className="start-button"
              style={{ marginBottom: '16px' }}
              onClick={() => startSession(undefined)}
            >
              Study All Subjects
            </button>

            <h3 style={{ marginBottom: '12px', marginTop: '8px' }}>Or pick a subject or topic:</h3>
            <div className="source-list">
              {sources.filter((s) => s.card_count > 0).map((source) => (
                <div key={source.source_id}>
                  <div className="card source-item">
                    <div className="source-info" style={{ cursor: 'pointer' }} onClick={() => toggleSourceExpand(source.source_id)}>
                      <div className="source-name">
                        <span style={{ marginRight: '6px', fontSize: '12px' }}>
                          {expandedSource === source.source_id ? '▼' : '▶'}
                        </span>
                        {source.filename}
                      </div>
                      <div className="source-status">
                        {source.card_count} cards &middot;{' '}
                        {source.due_count > 0 && <strong>{source.due_count} due</strong>}
                        {source.due_count === 0 && `${source.new_count} new`}
                        {source.learning_count > 0 && ` · ${source.learning_count} learning`}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => startSession(source.source_id)}
                      disabled={source.due_count === 0 && source.new_count === 0 && source.learning_count === 0}
                    >
                      Study All
                    </button>
                  </div>

                  {/* Expanded topic list */}
                  {expandedSource === source.source_id && (
                    <div className="topic-list-expand">
                      {loadingTopics === source.source_id && (
                        <div style={{ padding: '12px 16px', color: '#7a7a92', fontSize: '13px' }}>Loading topics...</div>
                      )}
                      {topicStats[source.source_id]?.map((topic) => (
                        <div key={topic.topic_id} className="topic-item">
                          <div className="topic-info">
                            <div className="topic-name">{topic.topic_title}</div>
                            <div className="topic-stats-line">
                              {topic.card_count} cards
                              {topic.due_count > 0 && <> · <strong>{topic.due_count} due</strong></>}
                              {topic.due_count === 0 && topic.new_count > 0 && <> · {topic.new_count} new</>}
                              {topic.learning_count > 0 && <> · {topic.learning_count} learning</>}
                            </div>
                          </div>
                          <button
                            className="btn btn-secondary"
                            onClick={() => startSession(undefined, topic.topic_id)}
                            disabled={topic.due_count === 0 && topic.new_count === 0 && topic.learning_count === 0}
                            style={{ fontSize: '12px', padding: '6px 12px' }}
                          >
                            Study Topic
                          </button>
                        </div>
                      ))}
                      {topicStats[source.source_id]?.length === 0 && (
                        <div style={{ padding: '12px 16px', color: '#7a7a92', fontSize: '13px' }}>No topics found.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // --- Session complete screen ---
  if (sessionComplete) {
    return (
      <div className="study-view">
        <div className="card session-complete">
          <h2>Session Complete!</h2>
          <div className="session-stats">
            <div className="stat-card">
              <div className="stat-number">{cardsStudied}</div>
              <div className="stat-label">Cards Studied</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">
                {cardsStudied > 0 ? Math.round((cardsCorrect / cardsStudied) * 100) : 0}%
              </div>
              <div className="stat-label">Accuracy</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => setPicking(true)}>
              Study More
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- No cards available ---
  if (!sessionActive || !cards.length) {
    return (
      <div className="study-view">
        <h1>Study</h1>
        {error && <div className="error-msg">{error}</div>}
        <div className="empty-state">
          <h3>No cards available right now</h3>
          <p>All caught up! Check back later when cards are due.</p>
          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => setPicking(true)}>
            Back to Subject Picker
          </button>
        </div>
      </div>
    )
  }

  // --- Active study ---
  const currentCard = cards[currentIndex]
  if (!currentCard) return null

  const options = currentCard.options_json ? JSON.parse(currentCard.options_json) : null
  const isMcq = currentCard.question_type === 'mcq' && options

  // Show the interval progression step labels
  const step = currentCard.step_index
  const intervals = {
    again: 'Day 0 (10m)',
    hard: INTERVAL_LABELS[Math.min(step, INTERVAL_LABELS.length - 1)] + ' (repeat)',
    good: INTERVAL_LABELS[Math.min(step + 1, INTERVAL_LABELS.length - 1)],
    easy: INTERVAL_LABELS[Math.min(step + 2, INTERVAL_LABELS.length - 1)],
  }

  const content = (
    <div className="study-main">
      <div className="study-header">
        <span className="study-progress">
          Card {currentIndex + 1} / {cards.length}
        </span>
        <span className="study-topic">
          {currentCard.topic_title || 'Unknown Topic'}
        </span>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="card question-card">
        <div className="question-meta">
          <span className="badge badge-type">{currentCard.question_type}</span>
          <span className={`badge badge-${currentCard.difficulty_tier}`}>
            {currentCard.difficulty_tier}
          </span>
          <span className="badge" style={{ background: '#222240', color: '#9898b0' }}>
            Step {step}/{INTERVAL_LABELS.length - 1}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-icon" title="Edit this card" onClick={openEditModal}>
            ✏️
          </button>
          <button className="btn btn-icon" title="View topic cards" onClick={openContextPanel}>
            📋
          </button>
        </div>

        <div className="question-text">{renderTextWithImages(currentCard.question_text, currentCard.source_id)}</div>

        {/* MCQ: clickable option buttons */}
        {isMcq && (
          <div style={{ marginTop: '12px' }}>
            {options.map((opt: string, i: number) => {
              const letter = String.fromCharCode(65 + i) // A, B, C, D
              const isSelected = selectedMcqOption === opt
              const isCorrect = checkResult?.correctness === 'correct'
              let className = 'mcq-option-btn'
              if (selectedMcqOption) {
                className += ' disabled'
                if (isSelected && isCorrect) className += ' selected-correct'
                else if (isSelected && !isCorrect) className += ' selected-incorrect'
                // Highlight the correct answer if user got it wrong
                if (!isCorrect && currentCard.answer_text.toLowerCase().startsWith(letter.toLowerCase())) {
                  className += ' correct-highlight'
                }
              }
              return (
                <button
                  key={i}
                  className={className}
                  onClick={() => !selectedMcqOption && handleMcqSelect(opt)}
                  disabled={!!selectedMcqOption}
                >
                  {opt}
                </button>
              )
            })}
          </div>
        )}

        {/* Free-text answer input (non-MCQ, before answer shown) */}
        {!isMcq && !showAnswer && (
          <div className="answer-input-area">
            <textarea
              ref={textareaRef}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder="Type your answer here..."
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && userAnswer.trim()) {
                  e.preventDefault()
                  handleCheckAnswer()
                }
              }}
            />
            {isListening && (
              <div className="voice-transcript-preview">
                <span className="listening-dot" /> Listening{interimTranscript ? ': ' : '...'}
                {interimTranscript && <em>{interimTranscript}</em>}
              </div>
            )}
            <div className="answer-input-controls">
              <button
                className="btn btn-primary"
                onClick={handleCheckAnswer}
                disabled={isChecking || !userAnswer.trim()}
                style={{ flex: 1 }}
              >
                {isChecking ? 'Checking...' : 'Check Answer (Enter)'}
              </button>
              <button
                className={`voice-btn ${isListening ? 'listening' : ''}`}
                onClick={isListening ? stopListening : startListening}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                {isListening ? '⏹' : '🎤'}
              </button>
            </div>
          </div>
        )}

        {/* AI feedback */}
        {checkResult && (
          <div className={`check-result ${checkResult.correctness}`}>
            <strong>
              {checkResult.correctness === 'correct' ? '✓ Correct' :
               checkResult.correctness === 'partial' ? '◐ Partially Correct' :
               '✗ Incorrect'}
            </strong>
            {checkResult.feedback && (
              <div style={{ marginTop: '4px' }}>{checkResult.feedback}</div>
            )}
          </div>
        )}

        {/* Correct answer revealed */}
        {showAnswer && (
          <div className="answer-section" style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12px', color: '#7a7a92', marginBottom: '4px', fontWeight: 600 }}>
              CORRECT ANSWER:
            </div>
            <div className="answer-text">{renderTextWithImages(currentCard.answer_text, currentCard.source_id)}</div>
            {currentCard.explanation && (
              <div className="explanation-text">{currentCard.explanation}</div>
            )}
          </div>
        )}
      </div>

      {/* Before answer: show skip option for free-text */}
      {!showAnswer && !isMcq && (
        <div style={{ textAlign: 'center', marginTop: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowAnswer(true)
              setCheckResult({ correctness: 'incorrect' as const, feedback: 'Skipped — self-assess below', suggested_grade: 0 })
            }}
            style={{ fontSize: '13px' }}
          >
            Skip / Show Answer (Space)
          </button>
        </div>
      )}

      {/* Grade buttons — shown after answer is revealed */}
      {showAnswer && (
        <>
          <div className="study-actions" style={{ marginTop: '12px' }}>
            {[
              { grade: 0, label: 'Again', interval: intervals.again, cls: 'btn-again' },
              { grade: 1, label: 'Hard', interval: intervals.hard, cls: 'btn-hard' },
              { grade: 2, label: 'Good', interval: intervals.good, cls: 'btn-good' },
              { grade: 3, label: 'Easy', interval: intervals.easy, cls: 'btn-easy' },
            ].map((btn) => (
              <button
                key={btn.grade}
                className={`btn ${btn.cls} ${checkResult?.suggested_grade === btn.grade ? 'suggested-grade' : ''}`}
                onClick={() => handleGrade(btn.grade)}
              >
                {btn.label}
                <span className="grade-label">{btn.interval} ({btn.grade + 1})</span>
              </button>
            ))}
          </div>

          {scheduleFeedback && (
            <div className="schedule-feedback">{scheduleFeedback}</div>
          )}

          <button
            className="btn btn-secondary tutor-toggle"
            onClick={() => setShowTutor(!showTutor)}
          >
            {showTutor ? 'Hide AI Tutor' : 'Ask AI Tutor'}
          </button>
        </>
      )}

      {/* Tutor toggle before answer for non-MCQ */}
      {!showAnswer && !isMcq && (
        <button
          className="btn btn-secondary tutor-toggle"
          onClick={() => setShowTutor(!showTutor)}
        >
          {showTutor ? 'Hide AI Tutor' : 'Ask AI Tutor'}
        </button>
      )}
    </div>
  )

  const editModal = showEditModal && (
    <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
      <div className="modal-content edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Card</h3>
          <button className="close-btn" onClick={() => setShowEditModal(false)}>x</button>
        </div>
        <div className="modal-body">
          <label>Question</label>
          <textarea
            value={editQuestion}
            onChange={(e) => setEditQuestion(e.target.value)}
            rows={4}
          />
          <label>Answer</label>
          <textarea
            value={editAnswer}
            onChange={(e) => setEditAnswer(e.target.value)}
            rows={4}
          />
          <label>Explanation (optional)</label>
          <textarea
            value={editExplanation}
            onChange={(e) => setEditExplanation(e.target.value)}
            rows={3}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveCardEdit} disabled={editSaving}>
            {editSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )

  const contextPanel = showContextPanel && (
    <div className="modal-overlay" onClick={() => setShowContextPanel(false)}>
      <div className="modal-content context-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Topic: {currentCard.topic_title || 'Unknown'}</h3>
          <button className="close-btn" onClick={() => setShowContextPanel(false)}>x</button>
        </div>
        <div className="modal-body">
          {loadingContext && <p style={{ color: '#7a7a92' }}>Loading cards...</p>}
          {!loadingContext && topicCards.length === 0 && (
            <p style={{ color: '#7a7a92' }}>No other cards in this topic.</p>
          )}
          {!loadingContext && topicCards.length > 0 && (
            <>
              <p style={{ fontSize: '13px', color: '#9898b0', marginBottom: '8px' }}>
                Select cards to merge with the current card. The current card is highlighted.
              </p>
              <div className="context-cards-list">
                {topicCards.map((tc) => {
                  const isCurrent = tc.id === currentCard.id
                  const isSelected = selectedForMerge.includes(tc.id)
                  return (
                    <div
                      key={tc.id}
                      className={`context-card-item${isCurrent ? ' current' : ''}${isSelected ? ' selected' : ''}`}
                      onClick={() => !isCurrent && toggleMergeSelect(tc.id)}
                    >
                      <div className="context-card-header">
                        {!isCurrent && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleMergeSelect(tc.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        {isCurrent && <span className="badge" style={{ background: '#3b82f6', color: '#fff', fontSize: '10px' }}>Current</span>}
                        <span className="badge badge-type" style={{ fontSize: '10px' }}>{tc.question_type}</span>
                      </div>
                      <div className="context-card-question">{tc.question_text}</div>
                      <div className="context-card-answer">{tc.answer_text}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        {selectedForMerge.length > 0 && (
          <div className="modal-footer">
            <span style={{ fontSize: '13px', color: '#9898b0' }}>
              {selectedForMerge.length} card{selectedForMerge.length > 1 ? 's' : ''} selected to merge
            </span>
            <button className="btn btn-primary" onClick={handleMerge} disabled={merging}>
              {merging ? 'Merging...' : `Merge ${selectedForMerge.length + 1} Cards`}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (showTutor) {
    return (
      <div className="study-with-tutor">
        {content}
        <TutorSidebar
          cardId={currentCard.id}
          onClose={() => setShowTutor(false)}
        />
        {editModal}
        {contextPanel}
      </div>
    )
  }

  return (
    <div className="study-view">
      {content}
      {editModal}
      {contextPanel}
    </div>
  )
}
