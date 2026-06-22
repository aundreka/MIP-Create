// Supabase client + auth for the team server. The cloud is an OPT-IN sync layer
// on top of the local library — the editor works fully offline; signing in adds
// "publish my MIP / browse the team / monitor progress". Configured via the
// VITE_SUPABASE_* env vars (see .env.example); absent vars => cloud is hidden.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// The single default org every signed-in user is auto-joined to (see migration).
export const ORG_ID = '00000000-0000-0000-0000-000000000001'

let client: SupabaseClient | null = null

export function isCloudConfigured(): boolean {
  return !!(URL && KEY)
}

export function supa(): SupabaseClient {
  if (!client) {
    if (!URL || !KEY) throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.')
    client = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  }
  return client
}

export async function getSession(): Promise<Session | null> {
  if (!isCloudConfigured()) return null
  const { data } = await supa().auth.getSession()
  return data.session
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!isCloudConfigured()) return () => {}
  const { data } = supa().auth.onAuthStateChange((_e, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

/** Send a magic-link / OTP email. Returns an error string on failure. */
export async function signInWithEmail(email: string): Promise<{ error?: string }> {
  const { error } = await supa().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin } })
  return error ? { error: error.message } : {}
}

export async function signOut(): Promise<void> {
  if (isCloudConfigured()) await supa().auth.signOut()
}
