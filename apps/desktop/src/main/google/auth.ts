import { createServer } from 'node:http'
import { shell, safeStorage } from 'electron'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { GoogleAuthStatus } from '@studiomaster/shared'
import type { Store } from '../store.js'

/**
 * Google OAuth via the loopback flow (docs §6.3). Desktop OAuth clients are
 * allowed to redirect to http://127.0.0.1:<random-port>. The refresh token is
 * stored encrypted with Electron safeStorage (DPAPI on Windows). Scopes are
 * minimal: drive.file, calendar.readonly, userinfo.email.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

const CLIENT_ID_KEY = 'google.clientId'
const CLIENT_SECRET_KEY = 'google.clientSecret' // encrypted
const REFRESH_TOKEN_KEY = 'google.refreshToken' // encrypted
const EMAIL_KEY = 'google.email'

export class GoogleAuthManager {
  constructor(private readonly store: Store) {}

  status(): GoogleAuthStatus {
    return {
      configured: !!this.clientId() && !!this.clientSecret(),
      connected: !!this.refreshToken(),
      email: this.store.getSetting(EMAIL_KEY) ?? undefined,
    }
  }

  setCredentials(clientId: string, clientSecret: string): GoogleAuthStatus {
    this.store.setSetting(CLIENT_ID_KEY, clientId.trim())
    this.store.setSetting(CLIENT_SECRET_KEY, this.encrypt(clientSecret.trim()))
    return this.status()
  }

  disconnect(): void {
    this.store.setSetting(REFRESH_TOKEN_KEY, '')
    this.store.setSetting(EMAIL_KEY, '')
  }

  /** Returns an authorized client (auto-refreshing), or null if not connected. */
  getClient(): OAuth2Client | null {
    const id = this.clientId()
    const secret = this.clientSecret()
    const refresh = this.refreshToken()
    if (!id || !secret || !refresh) return null
    const client = new google.auth.OAuth2(id, secret)
    client.setCredentials({ refresh_token: refresh })
    return client
  }

  /** Run the interactive loopback consent flow. */
  async connect(): Promise<GoogleAuthStatus> {
    const id = this.clientId()
    const secret = this.clientSecret()
    if (!id || !secret) {
      return { ...this.status(), error: 'הזן Client ID ו-Client Secret של גוגל תחילה' }
    }

    return new Promise<GoogleAuthStatus>((resolve) => {
      let client: OAuth2Client
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const code = url.searchParams.get('code')
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end('<h3>אפשר לחזור ל-StudioMaster ✓</h3>')
          server.close()
          if (!code) return resolve({ ...this.status(), error: 'לא התקבל קוד הרשאה' })
          const { tokens } = await client.getToken(code)
          if (tokens.refresh_token) {
            this.store.setSetting(REFRESH_TOKEN_KEY, this.encrypt(tokens.refresh_token))
          }
          client.setCredentials(tokens)
          await this.captureEmail(client)
          resolve(this.status())
        } catch (err) {
          resolve({ ...this.status(), error: err instanceof Error ? err.message : String(err) })
        }
      })

      server.on('error', (err) => resolve({ ...this.status(), error: err.message }))
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        client = new google.auth.OAuth2(id, secret, `http://127.0.0.1:${port}`)
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
        })
        void shell.openExternal(authUrl)
      })
    })
  }

  private async captureEmail(client: OAuth2Client): Promise<void> {
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client })
      const { data } = await oauth2.userinfo.get()
      if (data.email) this.store.setSetting(EMAIL_KEY, data.email)
    } catch {
      // email is nice-to-have; ignore failures
    }
  }

  private clientId(): string | null {
    return this.store.getSetting(CLIENT_ID_KEY) || null
  }
  private clientSecret(): string | null {
    return this.decrypt(this.store.getSetting(CLIENT_SECRET_KEY))
  }
  private refreshToken(): string | null {
    return this.decrypt(this.store.getSetting(REFRESH_TOKEN_KEY))
  }

  private encrypt(value: string): string {
    if (!value) return ''
    if (!safeStorage.isEncryptionAvailable()) return `plain:${value}`
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  private decrypt(stored: string | null): string | null {
    if (!stored) return null
    if (stored.startsWith('plain:')) return stored.slice(6)
    if (stored.startsWith('enc:')) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      } catch {
        return null
      }
    }
    return stored
  }
}
