import { useState, useEffect, useMemo } from 'react'
import { getReports } from '../api/client'

interface TopicStat {
  topic_id: number;
  topic_title: string;
  source_filename: string;
  total_reviews: number;
  correct_count: number;
  accuracy_pct: number;
  avg_time_sec: number;
}

interface DailyStat {
  review_date: string;
  review_count: number;
  correct_count: number;
}

interface ScheduleOverview {
  due_today: number;
  due_this_week: number;
  due_this_month: number;
  due_later: number;
  new_cards: number;
}

type SortKey = 'source_filename' | 'topic_title' | 'total_reviews' | 'accuracy_pct' | 'avg_time_sec'

export default function ReportsView() {
  const [topicStats, setTopicStats] = useState<TopicStat[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([])
  const [schedule, setSchedule] = useState<ScheduleOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('source_filename')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    loadReports()
  }, [])

  async function loadReports() {
    try {
      const data = await getReports()
      setTopicStats(data.topic_stats || [])
      setDailyStats(data.daily_stats || [])
      setSchedule(data.schedule_overview || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortedTopics = useMemo(() => {
    const sorted = [...topicStats].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
    })
    return sorted
  }, [topicStats, sortKey, sortAsc])

  // Build daily chart data: fill in missing days with zeros
  const chartData = useMemo(() => {
    const result: { date: string; reviews: number; correct: number; label: string }[] = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const found = dailyStats.find((s) => s.review_date === dateStr)
      result.push({
        date: dateStr,
        reviews: found?.review_count || 0,
        correct: found?.correct_count || 0,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }
    return result
  }, [dailyStats])

  const maxReviews = Math.max(1, ...chartData.map((d) => d.reviews))

  if (loading) {
    return (
      <div className="reports-view">
        <h1>Reports</h1>
        <p style={{ color: '#7a7a92' }}>Loading reports...</p>
      </div>
    )
  }

  return (
    <div className="reports-view">
      <h1>Reports</h1>
      {error && <div className="error-msg">{error}</div>}

      {/* Schedule Overview */}
      {schedule && (
        <div className="reports-section">
          <h2>Schedule Overview</h2>
          <div className="stats-grid" style={{ marginBottom: '8px' }}>
            <div className="card stat-card">
              <div className="stat-number" style={{ color: '#f87171' }}>{schedule.due_today}</div>
              <div className="stat-label">Due Today</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number" style={{ color: '#fb923c' }}>{schedule.due_this_week}</div>
              <div className="stat-label">Due This Week</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number" style={{ color: '#facc15' }}>{schedule.due_this_month}</div>
              <div className="stat-label">Due This Month</div>
            </div>
          </div>
          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-number" style={{ color: '#60a5fa' }}>{schedule.due_later}</div>
              <div className="stat-label">Due Later</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number" style={{ color: '#4ade80' }}>{schedule.new_cards}</div>
              <div className="stat-label">New (Unseen)</div>
            </div>
            <div className="card stat-card">
              <div className="stat-number">{schedule.due_today + schedule.due_this_week + schedule.due_this_month + schedule.due_later + schedule.new_cards}</div>
              <div className="stat-label">Total Active</div>
            </div>
          </div>
        </div>
      )}

      {/* Daily Activity Chart */}
      <div className="reports-section">
        <h2>Daily Activity (Last 30 Days)</h2>
        {dailyStats.length === 0 && chartData.every((d) => d.reviews === 0) ? (
          <p style={{ color: '#7a7a92', fontSize: '14px' }}>No review activity yet. Start studying to see your progress here.</p>
        ) : (
          <div className="daily-chart">
            <div className="chart-bars">
              {chartData.map((d, i) => (
                <div key={d.date} className="chart-bar-container" title={`${d.label}: ${d.reviews} reviews (${d.correct} correct)`}>
                  <div className="chart-bar-stack" style={{ height: `${(d.reviews / maxReviews) * 100}%` }}>
                    <div
                      className="chart-bar correct"
                      style={{ height: d.reviews > 0 ? `${(d.correct / d.reviews) * 100}%` : '0%' }}
                    />
                    <div
                      className="chart-bar incorrect"
                      style={{ height: d.reviews > 0 ? `${((d.reviews - d.correct) / d.reviews) * 100}%` : '0%' }}
                    />
                  </div>
                  {i % 5 === 0 && <div className="chart-label">{d.label}</div>}
                </div>
              ))}
            </div>
            <div className="chart-legend">
              <span><span className="legend-dot correct" /> Correct</span>
              <span><span className="legend-dot incorrect" /> Incorrect</span>
            </div>
          </div>
        )}
      </div>

      {/* Topic Performance Table */}
      <div className="reports-section">
        <h2>Topic Performance</h2>
        {sortedTopics.length === 0 ? (
          <p style={{ color: '#7a7a92', fontSize: '14px' }}>No topics found. Import content and generate questions to see topic performance.</p>
        ) : (
          <table className="card-table reports-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('source_filename')} style={{ cursor: 'pointer' }}>
                  Source {sortKey === 'source_filename' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('topic_title')} style={{ cursor: 'pointer' }}>
                  Topic {sortKey === 'topic_title' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('total_reviews')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                  Reviews {sortKey === 'total_reviews' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('accuracy_pct')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                  Accuracy {sortKey === 'accuracy_pct' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('avg_time_sec')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                  Avg Time {sortKey === 'avg_time_sec' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTopics.map((topic) => (
                <tr key={topic.topic_id}>
                  <td style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {topic.source_filename}
                  </td>
                  <td>{topic.topic_title}</td>
                  <td style={{ textAlign: 'right' }}>{topic.total_reviews}</td>
                  <td style={{ textAlign: 'right' }}>
                    {topic.total_reviews > 0 ? (
                      <span style={{
                        color: topic.accuracy_pct >= 80 ? '#4ade80' : topic.accuracy_pct >= 50 ? '#facc15' : '#f87171',
                        fontWeight: 600,
                      }}>
                        {topic.accuracy_pct}%
                      </span>
                    ) : (
                      <span style={{ color: '#4a4a62' }}>--</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {topic.total_reviews > 0 ? `${topic.avg_time_sec}s` : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
