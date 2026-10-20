import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, DEMO_MODE } from '../lib/supabase'
import { startImpersonation, setReadOnly } from '../lib/db'
import {
  DEMO_USERS,
  DEMO_CREDENTIALS,
} from '../lib/demoData'

const AuthContext = createContext({})
const SESSION_KEY = 'turftime_demo_uid'
// Where the ADMIN's own session is parked while they view as someone else.
// sessionStorage, not state: a reload mid-view must still be able to get back.
const IMP_KEY = 'tt_impersonation'

// ── Demo auth helpers ────────────────────────────────────────
function demoSignIn(email, password) {
  const cred = DEMO_CREDENTIALS[email.toLowerCase()]
  if (!cred || cred.password !== password) {
    return { error: { message: 'Invalid email or password.' } }
  }
  localStorage.setItem(SESSION_KEY, cred.userId)
  return { error: null }
}

function demoSignOut() {
  localStorage.removeItem(SESSION_KEY)
}

function demoGetProfile() {
  const id = localStorage.getItem(SESSION_KEY)
  return id ? DEMO_USERS.find(u => u.id === id) ?? null : null
}

// ── Provider ─────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user,           setUser]           = useState(undefined) // undefined = loading
  const [profile,        setProfile]        = useState(null)
  const [previewProfile, setPreviewProfile] = useState(null)
  const [deactivated,    setDeactivated]    = useState(false)

  // ── Demo mode ──────────────────────────────────────────────
  useEffect(() => {
    if (!DEMO_MODE) return
    const p = demoGetProfile()
    setProfile(p)
    setUser(p ? { id: p.id } : null)
  }, [])

  // ── Live Supabase mode ─────────────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) return

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setUser(null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) fetchProfile(session.user.id)
        else { setProfile(null); setUser(null) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(authId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_id', authId)
      .single()
    // Deactivated accounts lose site access — sign them out immediately. Their
    // deals/stats stay intact in the DB; this only blocks the login.
    if (data && data.active === false) {
      await supabase.auth.signOut()
      setProfile(null); setUser(null)
      setDeactivated(true)
      return
    }
    setProfile(data ?? null)
  }

  // ── Unified sign-in ────────────────────────────────────────
  async function signIn(email, password) {
    if (DEMO_MODE) {
      const result = demoSignIn(email, password)
      if (!result.error) {
        const p = demoGetProfile()
        setProfile(p)
        setUser(p ? { id: p.id } : null)
      }
      return result
    }
    setDeactivated(false)
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signOut() {
    setPreviewProfile(null)
    if (DEMO_MODE) {
      demoSignOut()
      setUser(null)
      setProfile(null)
      return
    }
    await supabase.auth.signOut()
  }

  // A logged-in user changing their OWN password — uses their session, so no
  // service key / backend needed. Demo mode has no real auth, so it no-ops.
  async function changePassword(newPassword) {
    if (DEMO_MODE) return { error: { message: 'Password changes are disabled in demo mode.' } }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error }
  }

  const loading = user === undefined

  // ── Viewing as another user, for real ──────────────────────
  // `previewAs` only swapped this object, so queries still ran with the
  // admin's own session — a rep's interface over an admin's data, which is
  // why it could never reproduce what a rep actually sees. This swaps the
  // SESSION, so the database treats the browser as that person.
  const [impersonating, setImpersonating] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(IMP_KEY) || 'null') } catch { return null }
  })
  // The app refuses every write while a borrowed session is in play.
  useEffect(() => { setReadOnly(!!impersonating) }, [impersonating])

  async function viewAsUser(targetProfile) {
    if (DEMO_MODE) return { ok: false, error: 'Disabled in demo mode.' }
    const { data: { session: mine } } = await supabase.auth.getSession()
    if (!mine?.refresh_token) return { ok: false, error: 'Your session could not be saved — sign in again first.' }
    const res = await startImpersonation(targetProfile.id)
    if (!res?.ok) return res || { ok: false, error: 'Could not start the view.' }
    // Park our own session BEFORE swapping, so an error mid-swap is recoverable.
    const parked = {
      admin: { access_token: mine.access_token, refresh_token: mine.refresh_token },
      viewing: res.profile,
    }
    try { sessionStorage.setItem(IMP_KEY, JSON.stringify(parked)) } catch { /* private window */ }
    const { error } = await supabase.auth.setSession(res.session)
    if (error) {
      try { sessionStorage.removeItem(IMP_KEY) } catch { /* ignore */ }
      return { ok: false, error: error.message || 'Could not switch session.' }
    }
    setImpersonating(parked)
    return { ok: true }
  }

  async function stopViewingAs() {
    const parked = impersonating
    // Clear the flag FIRST: if the restore fails the user must not be stuck
    // read-only with no way out — a reload then lands them on the login page,
    // which is recoverable, where a silent read-only state is not.
    try { sessionStorage.removeItem(IMP_KEY) } catch { /* ignore */ }
    setImpersonating(null)
    if (parked?.admin) await supabase.auth.setSession(parked.admin)
    window.location.reload()
  }

  // Effective profile: preview overrides the real profile for all consumers
  const effectiveProfile = previewProfile ?? profile

  const value = {
    user: user ?? null,
    profile:        effectiveProfile,
    realProfile:    profile,
    // Site access (admin) is separate from sales title (role): admin = the
    // 'admin' title OR the is_admin flag.
    isAdmin:        effectiveProfile?.role === 'admin' || effectiveProfile?.is_admin === true,
    isPreviewMode:  !!previewProfile,
    previewAs:      (userProfile) => setPreviewProfile(userProfile),
    clearPreview:   () => setPreviewProfile(null),
    // Real impersonation (session swap), distinct from the role-clamp preview.
    isViewingAs:    !!impersonating,
    viewingAs:      impersonating?.viewing ?? null,
    viewAsUser,
    stopViewingAs,
    loading,
    demoMode: DEMO_MODE,
    deactivated,
    signIn,
    signOut,
    changePassword,
    refreshProfile: () => {
      if (DEMO_MODE) {
        setProfile(demoGetProfile())
      } else if (user) {
        fetchProfile(user.id)
      }
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
