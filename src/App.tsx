import { useState } from 'react'
import DashboardView from './views/DashboardView'
import ImportView from './views/ImportView'
import StudyView from './views/StudyView'
import LibraryView from './views/LibraryView'
import ReportsView from './views/ReportsView'
import SettingsView from './views/SettingsView'
import './styles.css'

type View = 'dashboard' | 'import' | 'study' | 'library' | 'reports' | 'settings'

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard')

  const navItems: { id: View; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'import', label: 'Import', icon: '📥' },
    { id: 'study', label: 'Study', icon: '📖' },
    { id: 'library', label: 'Library', icon: '📚' },
    { id: 'reports', label: 'Reports', icon: '📈' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h2>AI Learn Tutor</h2>
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => setCurrentView(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <main className="main-content">
        {currentView === 'dashboard' && <DashboardView onNavigate={setCurrentView} />}
        {currentView === 'import' && <ImportView />}
        {currentView === 'study' && <StudyView />}
        {currentView === 'library' && <LibraryView />}
        {currentView === 'reports' && <ReportsView />}
        {currentView === 'settings' && <SettingsView />}
      </main>
      <nav className="mobile-bottom-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => setCurrentView(item.id)}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
