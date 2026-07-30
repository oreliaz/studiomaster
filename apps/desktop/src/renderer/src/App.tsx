import { useState } from 'react'
import { CloudView } from './views/CloudView.js'
import { DashboardView } from './views/DashboardView.js'
import { LiveView } from './views/LiveView.js'
import { KnowledgeView } from './views/KnowledgeView.js'
import { PodcastsView } from './views/PodcastsView.js'
import { ProfilesView } from './views/ProfilesView.js'
import { WizardView } from './views/WizardView.js'
import { getLang, setLang, t } from './i18n.js'

type View = 'wizard' | 'dashboard' | 'live' | 'cloud' | 'profiles' | 'podcasts' | 'kb'

const NAV: { id: View; key: string }[] = [
  { id: 'wizard', key: 'nav.wizard' },
  { id: 'dashboard', key: 'nav.dashboard' },
  { id: 'live', key: 'nav.live' },
  { id: 'cloud', key: 'nav.cloud' },
  { id: 'profiles', key: 'nav.profiles' },
  { id: 'podcasts', key: 'nav.podcasts' },
  { id: 'kb', key: 'nav.kb' },
]

export function App(): JSX.Element {
  const [view, setView] = useState<View>('wizard')
  const lang = getLang()

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
            {t(item.key)}
          </button>
        ))}
        <button
          className="nav__lang"
          onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
          title="Language"
        >
          {lang === 'he' ? 'EN' : 'עב'}
        </button>
      </nav>
      <main className="main">
        {view === 'wizard' && <WizardView />}
        {view === 'dashboard' && <DashboardView />}
        {view === 'live' && <LiveView />}
        {view === 'cloud' && <CloudView />}
        {view === 'profiles' && <ProfilesView />}
        {view === 'podcasts' && <PodcastsView />}
        {view === 'kb' && <KnowledgeView />}
      </main>
    </div>
  )
}
