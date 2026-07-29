/** Minimal he/en i18n. The UI language is stored locally; toggling reloads. */

export type Lang = 'he' | 'en'

const DICT: Record<Lang, Record<string, string>> = {
  he: {
    'nav.wizard': 'פתיחת אולפן',
    'nav.dashboard': 'הקלטה',
    'nav.live': 'אולפן חי',
    'nav.cloud': 'ענן ועריכה',
    'nav.profiles': 'אולפנים',
    'nav.podcasts': 'פודקאסטים',
    'rec.title': 'הקלטת שמע (ציוד האולפן)',
    'rec.hint': 'הקלטה מרובת-ערוצים = ערוץ נפרד לכל מיקרופון, מפוצל אוטומטית לקבצים בסיום.',
    'podcasts.title': 'פודקאסטים',
    'podcasts.new': '+ פודקאסט חדש',
    'podcasts.empty': 'אין פודקאסטים עדיין. צור אחד חדש.',
    'podcasts.pick': 'בחר פודקאסט מהרשימה או צור חדש.',
    'podcast.name': 'שם הפודקאסט',
    'podcast.runmode': 'טיפול לאחר ההקלטה (מתי לערוך)',
    'record.podcast': 'איזה פודקאסט מקליטים עכשיו?',
    'record.noPodcast': 'אין פודקאסטים — צור אחד בלשונית "פודקאסטים".',
    'cloud.title': 'ענן ועריכה',
    'cloud.runmode': 'מתי להריץ עורך אוטומטי',
    'runmode.ask': 'לשאול / ידני',
    'runmode.now': 'מיד בסיום הקלטה',
    'runmode.nightly': 'אוטומטי בלילה (00:00–08:00)',
    'edit.run': 'ערוך אוטומטית',
    'edit.pending': 'ממתין לעריכה',
    'edit.running': 'עורך…',
    'edit.done': 'עריכה הושלמה',
    'edit.error': 'שגיאת עריכה',
    'q.title': 'שאלון תוצרים',
    'q.editType': 'סוג עריכה',
    'q.language': 'שפת התוכן',
    'q.intro': 'פתיח (נתיב קובץ)',
    'q.outro': 'סגיר (נתיב קובץ)',
    'q.reelsCount': 'כמה רילסים',
    'q.reelStyle': 'סגנון רילס',
    'q.socialUpload': 'העלאה לסושיאל',
    'q.multitrack': 'הקלטה מרובת-ערוצים',
    'q.routed': 'ניתוב שמע',
    'editType.none': 'ללא',
    'editType.basic': 'עריכה בסיסית',
    'editType.reels': 'רילסים',
    'editType.both': 'בסיסית + רילסים',
    'style.simple': 'פשוט',
    'style.premium': 'פרימיום (כריסלייט)',
  },
  en: {
    'nav.wizard': 'Open Studio',
    'nav.dashboard': 'Record',
    'nav.live': 'Live',
    'nav.cloud': 'Cloud & Edit',
    'nav.profiles': 'Studios',
    'nav.podcasts': 'Podcasts',
    'rec.title': 'Audio recording (studio equipment)',
    'rec.hint': 'Multi-track = a separate channel per microphone, auto-split into files on stop.',
    'podcasts.title': 'Podcasts',
    'podcasts.new': '+ New podcast',
    'podcasts.empty': 'No podcasts yet. Create one.',
    'podcasts.pick': 'Pick a podcast from the list or create a new one.',
    'podcast.name': 'Podcast name',
    'podcast.runmode': 'Post-recording treatment (when to edit)',
    'record.podcast': 'Which podcast are you recording now?',
    'record.noPodcast': 'No podcasts — create one in the "Podcasts" tab.',
    'cloud.title': 'Cloud & Edit',
    'cloud.runmode': 'When to run the auto editor',
    'runmode.ask': 'Ask / manual',
    'runmode.now': 'Right after recording',
    'runmode.nightly': 'Overnight (00:00–08:00)',
    'edit.run': 'Edit automatically',
    'edit.pending': 'Pending edit',
    'edit.running': 'Editing…',
    'edit.done': 'Edit complete',
    'edit.error': 'Edit error',
    'q.title': 'Deliverables questionnaire',
    'q.editType': 'Edit type',
    'q.language': 'Content language',
    'q.intro': 'Intro (file path)',
    'q.outro': 'Outro (file path)',
    'q.reelsCount': 'How many reels',
    'q.reelStyle': 'Reel style',
    'q.socialUpload': 'Upload to social',
    'q.multitrack': 'Multi-track recording',
    'q.routed': 'Audio routing',
    'editType.none': 'None',
    'editType.basic': 'Basic editing',
    'editType.reels': 'Reels',
    'editType.both': 'Basic + reels',
    'style.simple': 'Simple',
    'style.premium': 'Premium (Chris-light)',
  },
}

export function getLang(): Lang {
  return (localStorage.getItem('lang') as Lang) || 'he'
}

export function setLang(lang: Lang): void {
  localStorage.setItem('lang', lang)
  location.reload()
}

export function isRtl(): boolean {
  return getLang() === 'he'
}

export function t(key: string): string {
  return DICT[getLang()][key] ?? DICT.he[key] ?? key
}
