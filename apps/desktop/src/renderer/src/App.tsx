import { useState } from 'react'
import { DashboardView } from './views/DashboardView.js'
import { LiveView } from './views/LiveView.js'
import { ProfilesView } from './views/ProfilesView.js'
import { WizardView } from './views/WizardView.js'

type View = 'wizard' | 'dashboard' | 'live' | 'profiles'

const NAV: { id: View; label: string }[] = [
  { id: 'wizard', label: 'פתיחת אולפן' },
  { id: 'dashboard', label: 'הקלטה' },
  { id: 'live', label: 'אולפן חי' },
  { id: 'profiles', label: 'אולפנים' },
]

export function App(): JSX.Element {
  const [view, setView] = useState<View>('wizard')

  return (
    <div className="shell">
      <nav className="nav">
        <div className="nav__brand">StudioMaster</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav__item ${view === item.id ? 'is-active' : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="main">
        {view === 'wizard' && <WizardView />}
        {view === 'dashboard' && <DashboardView />}
        {view === 'live' && <LiveView />}
        {view === 'profiles' && <ProfilesView />}
      </main>
    </div>
  )
}
