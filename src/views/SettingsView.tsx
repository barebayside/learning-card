import { useState, useEffect } from 'react'
import { getSettings, updateSetting } from '../api/client'

export default function SettingsView() {
  const [settings, setSettings] = useState<any>({})
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      const data = await getSettings()
      setSettings(data)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function saveSetting(key: string, value: any) {
    try {
      await updateSetting(key, value)
      setSuccess('Setting saved.')
      setTimeout(() => setSuccess(''), 2000)
      await loadSettings()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="settings-view">
      <h1>Settings</h1>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      <div className="card setting-group">
        <h3>Study Settings</h3>
        <div className="setting-row">
          <label>New cards per day:</label>
          <input
            type="number"
            value={settings.daily_new_card_limit ?? 20}
            onChange={(e) => saveSetting('daily_new_card_limit', parseInt(e.target.value) || 20)}
            min={1}
            max={100}
          />
        </div>
        <div className="setting-row">
          <label>Max reviews per day:</label>
          <input
            type="number"
            value={settings.daily_review_limit ?? 200}
            onChange={(e) => saveSetting('daily_review_limit', parseInt(e.target.value) || 200)}
            min={10}
            max={1000}
          />
        </div>
      </div>
    </div>
  )
}
