/** Minimal he/en i18n. The UI language is stored locally; toggling reloads. */

export type Lang = 'he' | 'en'

const DICT: Record<Lang, Record<string, string>> = {
  he: {
    'nav.wizard': 'פתיחת אולפן',
    'nav.dashboard': 'הקלטה',
    'nav.live': 'אולפן חי',
    'nav.cloud': 'ענן ועריכה',
    'nav.profiles': 'אולפנים',
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
