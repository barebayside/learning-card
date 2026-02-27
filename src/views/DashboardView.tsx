import { useState, useEffect } from 'react'
import { getCardStats } from '../api/client'
import type { CardStats } from '../types'

interface Props {
  onNavigate: (view: 'dashboard' | 'import' | 'study' | 'library' | 'reports' | 'settings') => void
}

export default function DashboardView({ onNavigate }: Props) {
  const [stats, setStats] = useState<CardStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const data = await getCardStats()
      setStats(data)
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      {error && <div className="error-msg">{error}</div>}

      {stats && (
        <>
          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-number">{stats.due_count}</div>
              <div className="stat-label">Cards Due</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number">{stats.reviews_today}</div>
              <div className="stat-label">Reviewed Today</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number">
                {stats.reviews_today > 0
                  ? Math.round((stats.correct_today / stats.reviews_today) * 100)
                  : 0}%
              </div>
              <div className="stat-label">Accuracy Today</div>
            </div>
          </div>

          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-number">{stats.total}</div>
              <div className="stat-label">Total Cards</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number">{stats.new_count}</div>
              <div className="stat-label">New Cards</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number">{stats.learning_count + stats.relearning_count}</div>
              <div className="stat-label">Learning</div>
            </div>
          </div>

          <button
            className="start-button"
            onClick={() => onNavigate('study')}
            disabled={stats.due_count === 0 && stats.new_count === 0 && stats.learning_count === 0}
          >
            {stats.due_count > 0 || stats.new_count > 0 || stats.learning_count > 0
              ? `Start Studying (${stats.due_count + stats.new_count + stats.learning_count} cards)`
              : 'No Cards to Study'}
          </button>

          {stats.total === 0 && (
            <div className="empty-state" style={{ marginTop: '24px' }}>
              <h3>Get Started</h3>
              <p>Import some content to begin generating study cards.</p>
              <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => onNavigate('import')}>
                Go to Import
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
