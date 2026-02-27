import { useState, useEffect, useRef } from 'react'
import { importFile, generateQuestions, getSources, deleteSource, getTopics } from '../api/client'
import type { ContentSource, Topic } from '../types'

export default function ImportView() {
  const [sources, setSources] = useState<ContentSource[]>([])
  const [topicsMap, setTopicsMap] = useState<Record<number, Topic[]>>({})
  const [expandedSource, setExpandedSource] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState<Record<number, string>>({})
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSources()
  }, [])

  async function loadSources() {
    try {
      const data = await getSources()
      setSources(data)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleFiles(files: FileList) {
    setError('')
    setSuccess('')

    for (const file of Array.from(files)) {
      try {
        const result = await importFile(file)
        const words = result.word_count ? ` (${result.word_count.toLocaleString()} words)` : ''
        setSuccess(`Imported "${file.name}"${words}. Click "Generate Questions" to create study cards.`)
        await loadSources()
      } catch (e: any) {
        setError(e.message)
      }
    }
  }

  async function toggleTopics(sourceId: number) {
    if (expandedSource === sourceId) {
      setExpandedSource(null)
      return
    }
    setExpandedSource(sourceId)
    if (!topicsMap[sourceId]) {
      try {
        const topics = await getTopics(sourceId)
        setTopicsMap((prev) => ({ ...prev, [sourceId]: topics }))
      } catch (e: any) {
        setError(e.message)
      }
    }
  }

  async function handleGenerate(sourceId: number) {
    setError('')
    setSuccess('')
    setLoading((prev) => ({ ...prev, [sourceId]: 'Starting...' }))

    try {
      const result = await generateQuestions(sourceId, (status) => {
        setLoading((prev) => ({ ...prev, [sourceId]: status }))
      })

      const topics = result.topics_found ? ` across ${result.topics_found} topics` : ''
      const msg = `Generated ${result.cards_generated} study cards${topics}.`
      const errCount = result.errors?.length || 0
      if (errCount > 0) {
        setSuccess(`${msg} (${errCount} topic${errCount > 1 ? 's' : ''} had errors)`)
        console.warn('Generation errors:', result.errors)
      } else {
        setSuccess(msg)
      }

      // Refresh topics list since AI just identified them
      setTopicsMap((prev) => {
        const next = { ...prev }
        delete next[sourceId]
        return next
      })
      await loadSources()

      setLoading((prev) => {
        const next = { ...prev }
        delete next[sourceId]
        return next
      })
    } catch (e: any) {
      setError(e.message)
      setLoading((prev) => {
        const next = { ...prev }
        delete next[sourceId]
        return next
      })
    }
  }

  async function handleDelete(sourceId: number) {
    try {
      await deleteSource(sourceId)
      setTopicsMap((prev) => {
        const next = { ...prev }
        delete next[sourceId]
        return next
      })
      if (expandedSource === sourceId) setExpandedSource(null)
      await loadSources()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="import-view">
      <h1>Import Content</h1>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files)
          }
        }}
        onClick={() => fileInput.current?.click()}
      >
        <h3>Drop files here or click to browse</h3>
        <p>Supports: JSON, DOCX, PDF, TXT</p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.docx,.pdf,.txt"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
          }}
        />
      </div>

      {sources.length > 0 && (
        <>
          <h2 style={{ marginBottom: '12px' }}>Imported Files</h2>
          <div className="source-list">
            {sources.map((source) => {
              const topics = topicsMap[source.id]
              const isExpanded = expandedSource === source.id

              return (
                <div key={source.id} className="card" style={{ padding: '16px', marginBottom: '8px' }}>
                  <div className="source-item" style={{ padding: 0 }}>
                    <div className="source-info" style={{ cursor: 'pointer' }} onClick={() => toggleTopics(source.id)}>
                      <div className="source-name">
                        {isExpanded ? '▾' : '▸'} {source.filename}
                      </div>
                      <div className={`source-status ${source.status}`}>
                        {loading[source.id] || source.status}
                        {source.error_message && ` - ${source.error_message}`}
                      </div>
                    </div>
                    <div className="source-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => handleGenerate(source.id)}
                        disabled={!!loading[source.id]}
                      >
                        {loading[source.id] ? 'Generating...' : 'Generate Questions'}
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(source.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {isExpanded && topics && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #eee' }}>
                      <div style={{ fontSize: '13px', color: '#555', marginBottom: '8px' }}>
                        {topics.length} topic{topics.length !== 1 ? 's' : ''} detected:
                      </div>
                      {topics.map((topic) => (
                        <div
                          key={topic.id}
                          style={{
                            padding: '8px 12px',
                            background: '#f8f8fc',
                            borderRadius: '6px',
                            marginBottom: '6px',
                            fontSize: '13px',
                          }}
                        >
                          <strong>{topic.title}</strong>
                          <span style={{ color: '#888', marginLeft: '8px' }}>
                            {topic.word_count} words
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
