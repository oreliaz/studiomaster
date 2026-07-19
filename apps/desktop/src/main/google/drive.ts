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
