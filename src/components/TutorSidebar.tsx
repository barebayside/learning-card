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
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const messagesEnd = useRef<HTMLDivElement>(null)
  const prevCardId = useRef(cardId)
  const recognitionRef = useRef<any>(null)

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

  function startListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceError('Voice not supported. Use Chrome.')
      return
    }

    setVoiceError('')
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

      if (finalText) {
        setInput((prev) => {
          const trimmedPrev = prev.trim()
          const trimmedFinal = finalText.trim()
          if (trimmedPrev && !trimmedPrev.endsWith(trimmedFinal)) {
            return trimmedPrev + ' ' + trimmedFinal
          }
          return trimmedFinal || trimmedPrev
        })
      }

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
        'not-allowed': 'Mic access denied.',
        'no-speech': 'No speech detected.',
        'audio-capture': 'No microphone found.',
        'network': 'Network error. Use Chrome, not Brave.',
      }
      setVoiceError(errorMap[event.error] || `Voice error: ${event.error}`)
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

      {isListening && (
        <div className="voice-transcript-preview" style={{ margin: '0 12px 4px', fontSize: '12px' }}>
          <span className="listening-dot" /> Listening{interimTranscript ? ': ' : '...'}
          {interimTranscript && <em>{interimTranscript}</em>}
        </div>
      )}
      {voiceError && (
        <div style={{ margin: '0 12px 4px', fontSize: '11px', color: '#f87171' }}>{voiceError}</div>
      )}
      <div className="tutor-input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage(input)
          }}
          placeholder={isListening ? 'Listening...' : 'Ask a question...'}
          disabled={isStreaming}
        />
        <button
          className={`voice-btn ${isListening ? 'listening' : ''}`}
          onClick={isListening ? stopListening : startListening}
          title={isListening ? 'Stop listening' : 'Voice input'}
          style={{ padding: '6px 10px', fontSize: '14px' }}
        >
          {isListening ? '⏹' : '🎤'}
        </button>
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
