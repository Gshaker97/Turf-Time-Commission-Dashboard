import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, BarChart2, DollarSign,
  Users, Users2, ShieldCheck, Eye, X,
  Home, PlusCircle,
} from 'lucide-react'
import NavBar from './NavBar'
import { useAuth } from '../contexts/AuthContext'

const NAV = [
  { to: '/home',        icon: Home,            label: 'Home',        roles: ['rep','manager','director','vp','admin'] },
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard',   roles: ['rep','manager','director','vp','admin'] },
  { to: '/deals',       icon: BarChart2,       label: 'Deals',       roles: ['rep','manager','director','vp','admin'] },
  { to: '/commissions', icon: DollarSign,      label: 'Commissions', roles: ['rep','manager','director','vp','admin'] },
  { to: '/team',        icon: Users2,          label: 'Team',        roles: ['rep','manager','director','vp','admin'] },
  { to: '/new-deal',    icon: PlusCircle,      label: 'New Deal',    roles: ['vp'] },
  { to: '/admin',       icon: ShieldCheck,     label: 'Admin',       roles: ['admin'] },
]

export default function Layout() {
  const { profile, isPreviewMode, clearPreview } = useAuth()
  const role  = profile?.role ?? 'rep'
  const items = NAV.filter(n => n.roles.includes(role))
  return (
    <div className="flex flex-col h-screen" style={{ background: '#1a1a1a' }}>
      {isPreviewMode && (
        <div
          className="flex items-center justify-between px-5 py-2.5 flex-shrink-0 z-50"
          style={{ background: '#f59e0b', color: '#1a1a1a' }}
        >
          <div className="flex items-center gap-2">
            <Eye size={14} strokeWidth={2.5} />
            <span className="text-[13px] font-semibold">
              Viewing as {profile?.name}
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.15)', color: '#1a1a1a' }}
            >
              {role}
            </span>
          </div>
          <button
            onClick={clearPreview}
            className="p-1 rounded hover:bg-black/15 transition-colors"
            title="Exit preview"
          >
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
      )}
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        <aside
          className="flex-shrink-0 flex flex-col py-4"
          style={{ width: 192, background: '#1e1e1e', borderRight: '1px solid #2a2a2a' }}
        >
          <nav className="px-3 space-y-0.5">
            {items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-teal/10 text-teal border border-teal/20'
                      : 'text-white/40 hover:text-white hover:bg-white/[0.04]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={15} className={isActive ? 'text-teal' : 'text-white/30'} />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto px-5 pb-1">
            <div
              className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded text-center"
              style={{
                background: isPreviewMode ? '#f59e0b22' : '#2a2a2a',
                color:      isPreviewMode ? '#f59e0b'   : '#00b894',
              }}
            >
              {role}
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
