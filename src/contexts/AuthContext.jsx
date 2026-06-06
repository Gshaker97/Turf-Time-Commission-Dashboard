import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, DEMO_MODE } from '../lib/supabase'
import {
  DEMO_USERS,
  DEMO_CREDENTIALS,
} from '../lib/demoData'

const AuthContext = createContext({})
const SESSION_KEY = 'turftime_demo_uid'

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

  const loading = user === undefined

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
    loading,
    demoMode: DEMO_MODE,
    signIn,
    signOut,
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
