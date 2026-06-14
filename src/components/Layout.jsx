import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, BarChart2, DollarSign,
  Users2, ShieldCheck, Eye, X,
  Home, Wallet, Trophy, Upload, ScanSearch,
} from 'lucide-react'
import NavBar from './NavBar'
import ErrorBoundary from './ErrorBoundary'
import { useAuth } from '../contexts/AuthContext'

const NAV = [
  { to: '/home',        icon: Home,            label: 'Home',        short: 'Home',    roles: ['rep','manager','director','vp','admin'] },
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard',   short: 'Stats',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/deals',       icon: BarChart2,       label: 'Deals',       short: 'Deals',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/commissions', icon: DollarSign,      label: 'Commissions', short: 'Pay',     roles: ['rep','manager','director','vp','admin'] },
  { to: '/competitions',icon: Trophy,          label: 'Competitions',short: 'Comps',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/team',        icon: Users2,          label: 'Team',        short: 'Team',    roles: ['rep','manager','director','vp','admin'] },
  { to: '/payroll',     icon: Wallet,          label: 'Payroll',     short: 'Payroll', roles: ['vp','admin'] },
  { to: '/import',      icon: Upload,          label: 'Import',      short: 'Import',  roles: ['vp','admin'] },
  { to: '/admin',       icon: ShieldCheck,     label: 'Admin',       short: 'Admin',   roles: ['admin'] },
]

// Keaton (by identity) or any admin sees the Requires-Audit tab. Keaton is a VP,
// not an admin, so this can't be expressed as a plain role on NAV above.
const AUDIT_NAV = { to: '/audit', icon: ScanSearch, label: 'Requires Audit', short: 'Audit' }
const isKeaton = (p) => p?.email?.toLowerCase() === 'keaton@turftime.com' || p?.name === 'Keaton Shaker'

export default function Layout() {
  const { profile, isPreviewMode, clearPreview, isAdmin } = useAuth()
  const { pathname } = useLocation()
  const role  = profile?.role ?? 'rep'
  // Admin-flag users see admin-gated nav items in addition to their title's.
  const effectiveRoles = isAdmin ? [role, 'admin'] : [role]
  const items = NAV.filter(n => n.roles.some(r => effectiveRoles.includes(r)))
  if (isAdmin || isKeaton(profile)) items.push(AUDIT_NAV)

  return (
    <div className="flex flex-col h-screen" style={{ background: '#1a1a1a' }}>

      {/* Preview banner */}
      {isPreviewMode && (
        <div className="flex items-center justify-between px-5 py-2.5 flex-shrink-0 z-50"
          style={{ background: '#f59e0b', color: '#1a1a1a' }}>
          <div className="flex items-center gap-2">
            <Eye size={14} strokeWidth={2.5} />
            <span className="text-[13px] font-semibold">Viewing as {profile?.name} · {profile?.role} permissions</span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.15)', color: '#1a1a1a' }}>{role}</span>
          </div>
          <button onClick={clearPreview} className="p-1 rounded hover:bg-black/15 transition-colors">
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <NavBar />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar: collapsed icon rail that expands to full labels on hover.
             Reserves only the narrow rail's width so the page content stays
             wide; the expanded panel overlays the content instead of pushing it. ── */}
        <aside className="hidden md:block flex-shrink-0 w-16 relative group">
          <div
            className="absolute inset-y-0 left-0 w-16 group-hover:w-52 transition-[width] duration-200 ease-out flex flex-col py-4 overflow-hidden z-40 group-hover:shadow-2xl"
            style={{ background: '#1e1e1e', borderRight: '1px solid #2a2a2a' }}
          >
            <nav className="px-2 group-hover:px-3 space-y-0.5 flex-1">
              {items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-2 group-hover:px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors
                     justify-center group-hover:justify-start ${
                      isActive
                        ? 'bg-teal/10 text-teal border border-teal/20'
                        : 'text-white/40 hover:text-white hover:bg-white/[0.04]'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={18} strokeWidth={isActive ? 2.5 : 1.5}
                        className={isActive ? 'text-teal flex-shrink-0' : 'text-white/30 flex-shrink-0'} />
                      <span className="hidden group-hover:inline whitespace-nowrap">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            {/* Role badge — dot when collapsed, full text on hover */}
            <div className="px-2 group-hover:px-5 pb-1">
              <div className="hidden group-hover:block text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded text-center whitespace-nowrap"
                style={{ background: isPreviewMode ? '#f59e0b22' : '#2a2a2a', color: isPreviewMode ? '#f59e0b' : '#00b894' }}>
                {role}
              </div>
              <div className="group-hover:hidden flex justify-center">
                <div className="w-2 h-2 rounded-full" style={{ background: isPreviewMode ? '#f59e0b' : '#00b894' }} />
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-3 md:p-5 lg:p-6 pb-24 md:pb-6">
          <Suspense fallback={
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 border-2 border-teal/30 border-t-teal rounded-full animate-spin" />
            </div>
          }>
            <ErrorBoundary key={pathname}>
              <Outlet />
            </ErrorBoundary>
          </Suspense>
        </main>
      </div>

      {/* ── Bottom tab bar: mobile only ── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 flex overflow-x-auto"
        style={{
          background: '#1e1e1e',
          borderTop: '1px solid #2a2a2a',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {items.map(({ to, icon: Icon, label, short }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2 flex-1 min-w-[56px] transition-colors ${
                isActive ? 'text-teal' : 'text-white/35'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                <span className="text-[10px] font-medium leading-none">{short}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

    </div>
  )
}
