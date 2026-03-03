import { useState, useRef, useEffect } from 'react'
import { streamTutorChat } from '../api/client'
import type { TutorMessage } from '../types'

interface Props {
  cardId: number
  onClose: () => void
}

export default function TutorSidebar({ cardId, onClose }: Props) {
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState(0)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const prevCardId = useRef(cardId)

  // Reset conversation when card changes
  useEffect(() => {
    if (cardId !== prevCardId.current) {
      setMessages([])
      setConversationId(0)
      prevCardId.current = cardId
    }
  }, [cardId])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return

    const userMsg: TutorMessage = { role: 'user', content: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)

    let assistantContent = ''
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    streamTutorChat(
      text.trim(),
      conversationId,
      cardId,
      (token) => {
        assistantContent += token
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
          return updated
        })
      },
      (convId) => {
        setConversationId(convId)
        setIsStreaming(false)
      },
    )
  }

  const quickActions = [
    'Explain this concept',
    'Give me a hint',
    'Why is this the answer?',
    'Simpler explanation',
  ]

  return (
    <div className="card tutor-sidebar">
      <div className="tutor-header">
        <h3>AI Tutor</h3>
        <button className="close-btn" onClick={onClose}>x</button>
      </div>

      <div className="tutor-quick-actions">
        {quickActions.map((action) => (
          <button
            key={action}
            className="quick-action-btn"
            onClick={() => sendMessage(action)}
            disabled={isStreaming}
          >
            {action}
          </button>
        ))}
      </div>

      <div className="tutor-messages">
        {messages.length === 0 && (
          <div style={{ color: '#7a7a92', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
            Ask the AI tutor anything about this question or topic.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`tutor-msg ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      <div className="tutor-input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage(input)
          }}
          placeholder="Ask a question..."
          disabled={isStreaming}
        />
        <button
          className="btn btn-primary"
          onClick={() => sendMessage(input)}
          disabled={isStreaming || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
