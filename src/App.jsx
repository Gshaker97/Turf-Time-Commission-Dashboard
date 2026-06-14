import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import Layout from './components/Layout'
import Login from './pages/Login'

// Authenticated pages are code-split — each loads on demand (and the heavy
// charting lib only ships with the Dashboard chunk), shrinking the initial load.
const Deals       = lazy(() => import('./pages/Deals'))
const Dashboard   = lazy(() => import('./pages/Dashboard'))
const Commissions = lazy(() => import('./pages/Commissions'))
const Team        = lazy(() => import('./pages/Team'))
const Admin       = lazy(() => import('./pages/Admin'))
const Home        = lazy(() => import('./pages/Home'))
const Payroll     = lazy(() => import('./pages/Payroll'))
const Competitions = lazy(() => import('./pages/Competitions'))
const ImportDeals = lazy(() => import('./pages/ImportDeals'))
const RequiresAudit = lazy(() => import('./pages/RequiresAudit'))

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a1a1a' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
        <p className="text-[12px] text-white/30">Loading…</p>
      </div>
    </div>
  )
}

function Guard({ children, roles }) {
  const { user, profile, loading, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!user)   return <Navigate to="/login" replace />
  if (!profile) return <Spinner />
  // Admin-flag users satisfy any 'admin' requirement, on top of their title.
  const effectiveRoles = isAdmin ? [profile.role, 'admin'] : [profile.role]
  if (roles && !roles.some(r => effectiveRoles.includes(r))) return <Navigate to="/dashboard" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<Guard><Layout /></Guard>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="deals"       element={<Deals />} />
        <Route path="dashboard"   element={<Dashboard />} />
        <Route path="commissions" element={<Commissions />} />
        <Route path="competitions" element={<Competitions />} />
        <Route path="home"        element={<Home />} />
        <Route path="payroll"     element={<Guard roles={['vp','admin']}><Payroll /></Guard>} />
        <Route path="import"      element={<Guard roles={['vp','admin']}><ImportDeals /></Guard>} />
        {/* Requires Audit: Keaton or admin only — the page self-guards by identity
            (Keaton is a VP, not an admin), so no role-based Guard here. */}
        <Route path="audit"       element={<RequiresAudit />} />
        <Route path="team"  element={
          <Guard roles={['manager','director','vp','admin']}><Team /></Guard>
        } />
        <Route path="admin" element={
          <Guard roles={['admin']}><Admin /></Guard>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <AppRoutes />
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
