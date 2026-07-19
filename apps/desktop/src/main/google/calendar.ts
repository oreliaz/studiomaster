import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { CalendarEvent } from '@studiomaster/shared'

/** Reads today's primary-calendar events (docs §6.3, Session Recognizer). */
export class CalendarClient {
  constructor(private readonly auth: OAuth2Client) {}

  async listToday(): Promise<CalendarEvent[]> {
    const calendar = google.calendar({ version: 'v3', auth: this.auth })
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date()
    dayEnd.setHours(23, 59, 59, 999)

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })

    return (data.items ?? []).map((ev) => ({
      id: ev.id ?? '',
      title: ev.summary ?? '(ללא כותרת)',
      start: ev.start?.dateTime ?? ev.start?.date ?? '',
      end: ev.end?.dateTime ?? ev.end?.date ?? '',
      attendees: (ev.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
      description: ev.description ?? undefined,
    }))
  }
}
