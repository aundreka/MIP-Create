// Team store — the cloud operations behind the Team panel. A `project` row is one
// MIP; its ProjectData blob lives in the `projects` Storage bucket at
// '<id>/data.json'. The cloud project id IS the editor's local library id, so a
// MIP maps 1:1 between this machine and the team server with no extra state.

import type { ProjectData } from '../bridge'
import { ORG_ID, supa } from './supabase'

export type MipStatus = 'draft' | 'in_review' | 'approved' | 'shipped'
export type Role = 'designer' | 'dev' | 'pm' | 'admin'

export interface MipRow {
  id: string
  client_name: string | null
  name: string
  mip: string | null
  mip_version: string | null
  owner_id: string | null
  status: MipStatus
  version: number
  updated_at: string
  data_path: string | null
}

export interface Profile {
  id: string
  email: string | null
}

const ROW_COLS = 'id,client_name,name,mip,mip_version,owner_id,status,version,updated_at,data_path'

export async function myRole(): Promise<Role | null> {
  const { data: u } = await supa().auth.getUser()
  const uid = u.user?.id
  if (!uid) return null
  const { data } = await supa().from('member').select('role').eq('org_id', ORG_ID).eq('user_id', uid).maybeSingle()
  return (data?.role as Role) ?? null
}

export async function listMips(): Promise<MipRow[]> {
  const { data, error } = await supa()
    .from('project')
    .select(ROW_COLS)
    .eq('org_id', ORG_ID)
    .order('client_name', { ascending: true })
    .order('mip', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MipRow[]
}

export async function listProfiles(): Promise<Profile[]> {
  const { data } = await supa().from('profiles').select('id,email')
  return (data ?? []) as Profile[]
}

export interface PublishArgs {
  id: string
  name: string
  client: string
  mip: string
  mipVersion?: string
  data: ProjectData
}

/** Create or update the current user's MIP on the server (row + blob). */
export async function publish(a: PublishArgs): Promise<MipRow> {
  const sb = supa()
  const { data: u } = await sb.auth.getUser()
  const uid = u.user?.id
  if (!uid) throw new Error('Not signed in.')

  // ensure the client exists → client_id
  const { data: cli, error: cErr } = await sb
    .from('client')
    .upsert({ org_id: ORG_ID, name: a.client }, { onConflict: 'org_id,name' })
    .select('id')
    .single()
  if (cErr) throw new Error('client: ' + cErr.message)

  // existing row → version bump + keep owner/status
  const { data: existing } = await sb.from('project').select('version,owner_id').eq('id', a.id).maybeSingle()
  const path = `${a.id}/data.json`
  const row: Record<string, unknown> = {
    id: a.id,
    org_id: ORG_ID,
    client_id: cli.id,
    client_name: a.client,
    name: a.name,
    mip: a.mip,
    mip_version: a.mipVersion || null,
    owner_id: existing?.owner_id ?? uid,
    version: (existing?.version ?? 0) + 1,
    data_path: path,
  }
  if (!existing) row.status = 'draft' // only set on create; never clobber a PM's status

  // Upsert the row FIRST — storage RLS checks the row exists + ownership on upload.
  const { error: pErr } = await sb.from('project').upsert(row).select('id').single()
  if (pErr) throw new Error('project: ' + pErr.message)

  const blob = new Blob([JSON.stringify(a.data)], { type: 'application/json' })
  const { error: sErr } = await sb.storage.from('projects').upload(path, blob, { upsert: true, contentType: 'application/json' })
  if (sErr) throw new Error('upload: ' + sErr.message)

  const { data: fresh, error: fErr } = await sb.from('project').select(ROW_COLS).eq('id', a.id).single()
  if (fErr) throw new Error(fErr.message)
  return fresh as MipRow
}

/** Download a MIP's ProjectData blob from Storage. */
export async function pull(id: string, dataPath: string | null): Promise<ProjectData> {
  const path = dataPath || `${id}/data.json`
  const { data, error } = await supa().storage.from('projects').download(path)
  if (error || !data) throw new Error('download: ' + (error?.message ?? 'no data'))
  return JSON.parse(await data.text()) as ProjectData
}

export async function setStatus(id: string, status: MipStatus): Promise<void> {
  const { error } = await supa().from('project').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function reassignOwner(id: string, ownerId: string): Promise<void> {
  const { error } = await supa().from('project').update({ owner_id: ownerId }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteMip(id: string): Promise<void> {
  const sb = supa()
  await sb.storage.from('projects').remove([`${id}/data.json`])
  const { error } = await sb.from('project').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
