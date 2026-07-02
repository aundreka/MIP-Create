// Share links — hand an editable copy of a MIP to another user via a short code /
// link. The whole bundle (scenes + assets-with-bytes + trace = ProjectData) is
// uploaded to the `shares` Storage bucket at '<code>.json'; anyone with the code can
// open it and gets their own editable copy. No sign-in required (the bucket allows
// the anon role — see the share_links_anon migration; codes are unguessable random
// strings). Decoupled from the team library (`project` rows) — a share is a one-shot
// snapshot, not a live sync.

import type { ProjectData } from '../bridge'
import { supa } from './supabase'

const BUCKET = 'shares'
// Unambiguous lowercase alphabet (no l / o / 0 / 1) → readable, hard-to-mistype codes.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const CODE_LEN = 8

/** Accept a bare code or a full '…#share=CODE' link and reduce to the raw code. */
export function sanitizeCode(raw: string): string {
  const m = /share=([a-z0-9]+)/i.exec(raw)
  return (m ? m[1] : raw).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function genCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** A shareable deep link that opens the editor and prefills this code to import. */
export function shareLink(code: string): string {
  return location.origin + location.pathname + '#share=' + code
}

/** Upload the given ProjectData as a new share; returns its code. No sign-in needed. */
export async function createShare(data: ProjectData): Promise<string> {
  const sb = supa()
  const code = genCode()
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const { error } = await sb.storage.from(BUCKET).upload(code + '.json', blob, { upsert: false, contentType: 'application/json' })
  if (error) throw new Error(error.message)
  return code
}

/** Download a shared ProjectData bundle by code (or share link). No sign-in needed. */
export async function fetchShare(codeOrLink: string): Promise<ProjectData> {
  const code = sanitizeCode(codeOrLink)
  if (!code) throw new Error('Enter a share code.')
  const { data, error } = await supa().storage.from(BUCKET).download(code + '.json')
  if (error || !data) throw new Error('Share not found. Double-check the code.')
  try {
    const parsed = JSON.parse(await data.text()) as ProjectData
    if (!parsed?.project?.scenes) throw new Error('bad')
    return parsed
  } catch {
    throw new Error('That share is corrupted or not a playable project.')
  }
}
