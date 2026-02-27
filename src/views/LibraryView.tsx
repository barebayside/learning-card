import { useState, useEffect } from 'react'
import { getAllCards, suspendCard, unsuspendCard, deleteCard, rescheduleCard, updateCard, mergeCards } from '../api/client'
import type { Card } from '../types'

const INTERVAL_LABELS = ['Day 0', 'Day 1', 'Day 4', 'Day 10', 'Day 25', 'Day 60', 'Day 150', 'Day 365'];

function formatDueDate(card: Card): string {
  if (card.card_state === 'new') return 'New'
  if (!card.due_date) return 'Not scheduled'
  const due = new Date(card.due_date)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < -1) return `Overdue ${Math.abs(diffDays)}d`
  if (diffDays < 0) return 'Due today'
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Tomorrow'
  return `In ${diffDays}d`
}

export default function LibraryView() {
  const [cards, setCards] = useState<Card[]>([])
  const [search, setSearch] = useState('')
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  // Edit modal state
  const [editingCard, setEditingCard] = useState<Card | null>(null)
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editExplanation, setEditExplanation] = useState('')
  const [editType, setEditType] = useState('')
  const [editDifficulty, setEditDifficulty] = useState('')

  // Reschedule state
  const [reschedulingCard, setReschedulingCard] = useState<number | null>(null)

  // Merge state
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set())
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [mergeQuestion, setMergeQuestion] = useState('')
  const [mergeAnswer, setMergeAnswer] = useState('')

  useEffect(() => {
    loadCards()
  }, [])

  async function loadCards() {
    try {
      const data = await getAllCards()
      setCards(data)
      const sourceNames = new Set(data.map((c: Card) => c.source_filename || 'Unknown'))
      setExpandedSources(sourceNames)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleSuspend(cardId: number, isSuspended: boolean) {
    try {
      if (isSuspended) {
        await unsuspendCard(cardId)
      } else {
        await suspendCard(cardId)
      }
      await loadCards()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleDelete(cardId: number) {
    try {
      await deleteCard(cardId)
      setSelectedCards((prev) => { const n = new Set(prev); n.delete(cardId); return n })
      await loadCards()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleReschedule(cardId: number, days: number) {
    try {
      await rescheduleCard(cardId, days)
      setReschedulingCard(null)
      await loadCards()
    } catch (e: any) {
      setError(e.message)
    }
  }

  function openEditModal(card: Card) {
    setEditingCard(card)
    setEditQuestion(card.question_text)
    setEditAnswer(card.answer_text)
    setEditExplanation(card.explanation || '')
    setEditType(card.question_type)
    setEditDifficulty(card.difficulty_tier)
  }

  async function handleSaveEdit() {
    if (!editingCard) return
    try {
      await updateCard(editingCard.id, {
        question_text: editQuestion,
        answer_text: editAnswer,
        explanation: editExplanation || null,
        question_type: editType,
        difficulty_tier: editDifficulty,
      })
      setEditingCard(null)
      await loadCards()
    } catch (e: any) {
      setError(e.message)
    }
  }

  function toggleCardSelection(cardId: number) {
    setSelectedCards((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) {
        next.delete(cardId)
      } else {
        next.add(cardId)
      }
      return next
    })
  }

  function openMergeDialog() {
    const selected = cards.filter((c) => selectedCards.has(c.id))
    setMergeQuestion(selected.map((c, i) => `(${i + 1}) ${c.question_text}`).join('\n\n'))
    setMergeAnswer(selected.map((c, i) => `(${i + 1}) ${c.answer_text}`).join('\n\n'))
    setShowMergeDialog(true)
  }

  async function handleMerge() {
    const ids = Array.from(selectedCards)
    if (ids.length < 2) return
    try {
      await mergeCards(ids, mergeQuestion, mergeAnswer)
      setShowMergeDialog(false)
      setSelectedCards(new Set())
      await loadCards()
    } catch (e: any) {
      setError(e.message)
    }
  }

  function toggleSource(sourceName: string) {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceName)) {
        next.delete(sourceName)
      } else {
        next.add(sourceName)
      }
      return next
    })
  }

  // Filter
  const filtered = cards.filter((card) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      card.question_text.toLowerCase().includes(q) ||
      card.answer_text.toLowerCase().includes(q) ||
      (card.topic_title || '').toLowerCase().includes(q) ||
      (card.source_filename || '').toLowerCase().includes(q)
    )
  })

  // Group by source file, then by topic
  const grouped: Record<string, Record<string, Card[]>> = {}
  for (const card of filtered) {
    const source = card.source_filename || 'Unknown'
    const topic = card.topic_title || 'Unknown Topic'
    if (!grouped[source]) grouped[source] = {}
    if (!grouped[source][topic]) grouped[source][topic] = []
    grouped[source][topic].push(card)
  }

  function stepLabel(card: Card): string {
    if (card.card_state === 'new') return 'New'
    const step = card.step_index
    if (step >= 0 && step < INTERVAL_LABELS.length) return INTERVAL_LABELS[step]
    return `Step ${step}`
  }

  return (
    <div className="library-view">
      <h1>Library ({cards.length} cards)</h1>

      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <input
          className="search-bar"
          placeholder="Search cards by question, answer, topic, or source..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        {selectedCards.size >= 2 && (
          <button className="btn btn-primary" onClick={openMergeDialog}>
            Merge Selected ({selectedCards.size})
          </button>
        )}
        {selectedCards.size > 0 && (
          <button className="btn btn-secondary" onClick={() => setSelectedCards(new Set())}>
            Clear Selection
          </button>
        )}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="empty-state">
          <h3>{cards.length === 0 ? 'No cards yet' : 'No matching cards'}</h3>
          <p>{cards.length === 0
            ? 'Import content and generate questions to see cards here.'
            : 'Try a different search term.'
          }</p>
        </div>
      ) : (
        Object.entries(grouped).map(([sourceName, topics]) => {
          const totalCards = Object.values(topics).reduce((sum, arr) => sum + arr.length, 0)
          const isExpanded = expandedSources.has(sourceName)

          return (
            <div key={sourceName} className="card" style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', padding: '4px 0',
                }}
                onClick={() => toggleSource(sourceName)}
              >
                <div>
                  <h3 style={{ marginBottom: '2px' }}>
                    {isExpanded ? '▾' : '▸'} {sourceName}
                  </h3>
                  <span style={{ fontSize: '13px', color: '#888' }}>
                    {totalCards} cards &middot; {Object.keys(topics).length} topics
                  </span>
                </div>
              </div>

              {isExpanded && Object.entries(topics).map(([topicName, topicCards]) => (
                <div key={topicName} style={{ marginTop: '12px', marginLeft: '16px' }}>
                  <h4 style={{ fontSize: '14px', color: '#3a3a6a', marginBottom: '8px' }}>
                    {topicName} ({topicCards.length} cards)
                  </h4>
                  <table className="card-table">
                    <thead>
                      <tr>
                        <th style={{ width: '30px' }}></th>
                        <th style={{ width: '35%' }}>Question</th>
                        <th>Type</th>
                        <th>State</th>
                        <th>Schedule</th>
                        <th>Due</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topicCards.map((card) => (
                        <tr key={card.id} style={{ opacity: card.is_suspended ? 0.5 : 1 }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedCards.has(card.id)}
                              onChange={() => toggleCardSelection(card.id)}
                            />
                          </td>
                          <td title={card.question_text}>
                            {card.question_text.length > 60
                              ? card.question_text.slice(0, 60) + '...'
                              : card.question_text}
                          </td>
                          <td>
                            <span className="badge badge-type">{card.question_type}</span>
                          </td>
                          <td>{card.card_state}</td>
                          <td>{stepLabel(card)}</td>
                          <td style={{ position: 'relative' }}>
                            <span
                              style={{ cursor: 'pointer', color: '#4a5cf0', fontSize: '12px' }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setReschedulingCard(reschedulingCard === card.id ? null : card.id)
                              }}
                            >
                              {formatDueDate(card)}
                            </span>
                            {reschedulingCard === card.id && (
                              <div
                                style={{
                                  position: 'absolute', zIndex: 10, background: '#fff',
                                  border: '1px solid #ddd', borderRadius: '8px', padding: '8px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginTop: '4px',
                                  left: 0, top: '100%',
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>Reschedule:</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                  {[
                                    { label: '1d', days: 1 },
                                    { label: '3d', days: 3 },
                                    { label: '1w', days: 7 },
                                    { label: '2w', days: 14 },
                                    { label: '1mo', days: 30 },
                                    { label: '3mo', days: 90 },
                                  ].map((opt) => (
                                    <button
                                      key={opt.days}
                                      className="btn btn-secondary"
                                      style={{ fontSize: '11px', padding: '3px 8px' }}
                                      onClick={() => handleReschedule(card.id, opt.days)}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                className="btn btn-secondary"
                                onClick={() => openEditModal(card)}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleSuspend(card.id, card.is_suspended)}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                {card.is_suspended ? 'Unsus.' : 'Suspend'}
                              </button>
                              <button
                                className="btn btn-danger"
                                onClick={() => handleDelete(card.id)}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )
        })
      )}

      {/* Edit Modal */}
      {editingCard && (
        <div className="modal-overlay" onClick={() => setEditingCard(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Card</h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Question</label>
              <textarea
                value={editQuestion}
                onChange={(e) => setEditQuestion(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Answer</label>
              <textarea
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                rows={4}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Explanation</label>
              <textarea
                value={editExplanation}
                onChange={(e) => setEditExplanation(e.target.value)}
                rows={2}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Type</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value)}
                  style={{ padding: '6px', borderRadius: '6px', border: '1px solid #ddd' }}>
                  <option value="recall">Recall</option>
                  <option value="conceptual">Conceptual</option>
                  <option value="mcq">MCQ</option>
                  <option value="open_ended">Open Ended</option>
                  <option value="application">Application</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Difficulty</label>
                <select value={editDifficulty} onChange={(e) => setEditDifficulty(e.target.value)}
                  style={{ padding: '6px', borderRadius: '6px', border: '1px solid #ddd' }}>
                  <option value="foundational">Foundational</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditingCard(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Dialog */}
      {showMergeDialog && (
        <div className="modal-overlay" onClick={() => setShowMergeDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h3>Merge {selectedCards.size} Cards</h3>
            <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              The first selected card will be kept and updated. All other selected cards will be deleted.
              Edit the merged content below before confirming.
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Merged Question</label>
              <textarea
                value={mergeQuestion}
                onChange={(e) => setMergeQuestion(e.target.value)}
                rows={5}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Merged Answer</label>
              <textarea
                value={mergeAnswer}
                onChange={(e) => setMergeAnswer(e.target.value)}
                rows={6}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowMergeDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleMerge}>Merge Cards</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
