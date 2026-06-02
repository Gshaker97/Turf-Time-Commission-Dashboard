import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, BarChart2, DollarSign,
  Users2, ShieldCheck, Eye, X,
  Home, PlusCircle,
} from 'lucide-react'
import NavBar from './NavBar'
import { useAuth } from '../contexts/AuthContext'

const NAV = [
  { to: '/home',        icon: Home,            label: 'Home',        short: 'Home',    roles: ['rep','manager','director','vp','admin'] },
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard',   short: 'Stats',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/deals',       icon: BarChart2,       label: 'Deals',       short: 'Deals',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/commissions', icon: DollarSign,      label: 'Commissions', short: 'Pay',     roles: ['rep','manager','director','vp','admin'] },
  { to: '/team',        icon: Users2,          label: 'Team',        short: 'Team',    roles: ['rep','manager','director','vp','admin'] },
  { to: '/new-deal',    icon: PlusCircle,      label: 'New Deal',    short: 'New',     roles: ['vp'] },
  { to: '/admin',       icon: ShieldCheck,     label: 'Admin',       short: 'Admin',   roles: ['admin'] },
]

export default function Layout() {
  const { profile, isPreviewMode, clearPreview } = useAuth()
  const role  = profile?.role ?? 'rep'
  const items = NAV.filter(n => n.roles.includes(role))

  return (
    <div className="flex flex-col h-screen" style={{ background: '#1a1a1a' }}>

      {/* Preview banner */}
      {isPreviewMode && (
        <div className="flex items-center justify-between px-5 py-2.5 flex-shrink-0 z-50"
          style={{ background: '#f59e0b', color: '#1a1a1a' }}>
          <div className="flex items-center gap-2">
            <Eye size={14} strokeWidth={2.5} />
            <span className="text-[13px] font-semibold">Viewing as {profile?.name}</span>
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

        {/* ── Sidebar: hidden on mobile, icon-only on tablet, full on desktop ── */}
        <aside
          className="hidden md:flex flex-col py-4 flex-shrink-0 w-16 lg:w-48"
          style={{ background: '#1e1e1e', borderRight: '1px solid #2a2a2a' }}
        >
          <nav className="px-2 lg:px-3 space-y-0.5 flex-1">
            {items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-2 lg:px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors
                   justify-center lg:justify-start ${
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
                    <span className="hidden lg:inline">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Role badge — full text on desktop, dot on tablet */}
          <div className="px-2 lg:px-5 pb-1">
            <div className="hidden lg:block text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded text-center"
              style={{ background: isPreviewMode ? '#f59e0b22' : '#2a2a2a', color: isPreviewMode ? '#f59e0b' : '#00b894' }}>
              {role}
            </div>
            <div className="lg:hidden flex justify-center">
              <div className="w-2 h-2 rounded-full" style={{ background: isPreviewMode ? '#f59e0b' : '#00b894' }} />
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-3 md:p-5 lg:p-6 pb-24 md:pb-6">
          <Outlet />
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
