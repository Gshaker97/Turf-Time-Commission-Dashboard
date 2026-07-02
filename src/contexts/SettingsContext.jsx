import { createContext, useContext, useEffect, useState } from 'react'
import { fetchSettings, saveSetting as saveSettingDb } from '../lib/db'
import { setOverrideRateSchedule } from '../utils/commission'
import { setPayDateRule } from '../utils/dateRanges'
import { useAuth } from './AuthContext'

// Who gets a bell notification when a deal note is posted (minus the author).
const NOTE_NOTIFY_DEFAULT = { closer: true, setter: false, manager: false, admins: true }

// Fallback config so the app renders correctly before settings load (and if
// the app_settings table hasn't been created yet on a live DB).
const DEFAULTS = {
  deal_statuses: [
    { label: 'Deal Review',     color: '#94a3b8' },
    { label: 'Pending Install', color: '#2dd4bf' },
    { label: 'Change Order',    color: '#f59e0b' },
    { label: 'Pay Finalized',   color: '#22d3ee' },
    { label: 'Paid',            color: '#4ade80' },
    { label: 'Sales Issue',     color: '#f87171' },
    { label: 'Canceled',        color: '#6b7280' },
  ],
  payment_methods: ['Self-Pay', 'Goodleap', 'Sunlight', 'Self-Pay + Sunlight', 'Self-Pay + Goodleap'],
  offices: ['Phoenix', 'Tucson'],
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const { user, profile } = useAuth()
  const [settings, setSettings] = useState(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  async function refresh() {
    const { data } = await fetchSettings()
    if (data && Object.keys(data).length) {
      setSettings(s => ({ ...DEFAULTS, ...s, ...data }))
    }
    setLoaded(true)
  }

  // Load on mount and whenever the signed-in user changes (so custom config
  // loads once RLS lets us read it).
  useEffect(() => { refresh() }, [user?.id])

  // Feed the admin-configured override-rate schedule + pay-date rule into the
  // plain util modules (not React consumers) whenever they load/change.
  useEffect(() => { setOverrideRateSchedule(settings.override_rates) }, [settings.override_rates])
  useEffect(() => { setPayDateRule(settings.pay_date_rule) }, [settings.pay_date_rule])

  // Optimistic save — update local state immediately so the whole app reflects
  // the change in real time, then persist.
  async function save(key, value) {
    setSettings(s => ({ ...s, [key]: value }))
    return saveSettingDb(key, value, profile?.id)
  }

  const statuses    = settings.deal_statuses?.length ? settings.deal_statuses : DEFAULTS.deal_statuses
  const statusLabels = statuses.map(s => s.label)
  const statusColor  = (label) => statuses.find(s => s.label === label)?.color || '#94a3b8'

  const value = {
    settings, loaded, refresh, save,
    siteName: settings.site_name || 'Turf Time Dashboard',
    // Deals whose sale_date is before this cutoff are "legacy" — they predate
    // our atomized data (office/pay date/payment), so background alerts and
    // staging leave them alone. They still count in historical totals.
    dataStartDate: settings.data_start_date || '2026-06-01',
    statuses, statusLabels, statusColor,
    paymentMethods: settings.payment_methods ?? [],
    offices: settings.offices ?? [],
    noteNotify: { ...NOTE_NOTIFY_DEFAULT, ...(settings.note_notify || {}) },
  }
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext) ?? {
  settings: DEFAULTS, loaded: false, refresh: () => {}, save: async () => ({}),
  statuses: DEFAULTS.deal_statuses, statusLabels: DEFAULTS.deal_statuses.map(s => s.label),
  statusColor: () => '#94a3b8', paymentMethods: DEFAULTS.payment_methods, offices: DEFAULTS.offices,
  siteName: 'Turf Time Dashboard', dataStartDate: '2026-06-01', noteNotify: NOTE_NOTIFY_DEFAULT,
}
