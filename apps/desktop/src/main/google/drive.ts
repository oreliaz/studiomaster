import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { google, type drive_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

/** Uploads session files to Google Drive (docs §6.3). */
export class DriveClient {
  private readonly drive: drive_v3.Drive

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: 'v3', auth })
  }

  /** Find or create a folder by name (optionally under a parent). Returns its id. */
  async ensureFolder(name: string, parentId?: string): Promise<string> {
    const safeName = name.replace(/'/g, "\\'")
    const filters = [
      `name='${safeName}'`,
      "mimeType='application/vnd.google-apps.folder'",
      'trashed=false',
    ]
    if (parentId) filters.push(`'${parentId}' in parents`)

    const existing = await this.drive.files.list({
      q: filters.join(' and '),
      fields: 'files(id,name)',
      spaces: 'drive',
    })
    const found = existing.data.files?.[0]?.id
    if (found) return found

    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      fields: 'id',
    })
    if (!created.data.id) throw new Error(`failed to create folder ${name}`)
    return created.data.id
  }

  /** Find a non-folder file by name under a parent. Returns its id, or null. */
  async findFile(name: string, parentId: string): Promise<string | null> {
    const safeName = name.replace(/'/g, "\\'")
    const res = await this.drive.files.list({
      q: `name='${safeName}' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
    })
    return res.data.files?.[0]?.id ?? null
  }

  /** Download a file's text content (empty string if it has none). */
  async downloadText(fileId: string): Promise<string> {
    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' },
    )
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }

  /** Create or overwrite a small JSON file by name under a folder. Returns its id. */
  async writeJson(name: string, parentId: string, content: string): Promise<string> {
    const existing = await this.findFile(name, parentId)
    const media = { mimeType: 'application/json', body: content }
    if (existing) {
      await this.drive.files.update({ fileId: existing, media })
      return existing
    }
    const created = await this.drive.files.create({
      requestBody: { name, parents: [parentId], mimeType: 'application/json' },
      media,
      fields: 'id',
    })
    if (!created.data.id) throw new Error(`failed to write ${name}`)
    return created.data.id
  }

  /** Upload one file into a folder; reports byte progress. Returns the file id. */
  async uploadFile(
    path: string,
    folderId: string,
    onProgress?: (bytes: number, total: number) => void,
  ): Promise<string> {
    const total = statSync(path).size
    const res = await this.drive.files.create(
      {
        requestBody: { name: basename(path), parents: [folderId] },
        media: { body: createReadStream(path) },
        fields: 'id',
      },
      { onUploadProgress: (e: { bytesRead: number }) => onProgress?.(e.bytesRead, total) },
    )
    if (!res.data.id) throw new Error(`upload failed for ${path}`)
    return res.data.id
  }
}
