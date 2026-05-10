/**
 * Thin data-access layer.
 * In demo mode, returns in-memory data.
 * In live mode, queries Supabase.
 */
import { supabase, DEMO_MODE } from './supabase'
import {
  DEMO_USERS,
  DEMO_DEALS_JOINED,
  DEMO_PAYMENTS,
} from './demoData'

// Local mutable copies for demo CRUD
let _deals    = DEMO_DEALS_JOINED.map(d => ({ ...d }))
let _users    = DEMO_USERS.map(u => ({ ...u }))
let _payments = DEMO_PAYMENTS.map(p => ({ ...p }))

const DEAL_SELECT = `
  *,
  setter:setter_id(id,name),
  closer:closer_id(id,name),
  manager:manager_id(id,name),
  director:director_id(id,name),
  vp:vp_id(id,name)
`

// ── Deals ─────────────────────────────────────────────────────
export async function fetchDeals() {
  if (DEMO_MODE) return { data: _deals, error: null }
  return supabase.from('deals').select(DEAL_SELECT).order('sale_date', { ascending: false })
}

export async function insertDeal(data, profileId) {
  if (DEMO_MODE) {
    const id = 'deal-' + Math.random().toString(36).slice(2, 9)
    const newDeal = {
      ...data,
      id,
      created_by: profileId,
      created_at: new Date().toISOString(),
      setter:   _users.find(u => u.id === data.setter_id)  ?? null,
      closer:   _users.find(u => u.id === data.closer_id)  ?? null,
      manager:  _users.find(u => u.id === data.manager_id) ?? null,
      director: _users.find(u => u.id === data.director_id)?? null,
      vp:       _users.find(u => u.id === data.vp_id)      ?? null,
    }
    _deals = [newDeal, ..._deals]
    return { error: null }
  }
  return supabase.from('deals').insert([{ ...data, created_by: profileId }])
}

export async function updateDeal(id, data) {
  if (DEMO_MODE) {
    _deals = _deals.map(d =>
      d.id === id
        ? {
            ...d, ...data,
            setter:   _users.find(u => u.id === data.setter_id)  ?? d.setter,
            closer:   _users.find(u => u.id === data.closer_id)  ?? d.closer,
            manager:  _users.find(u => u.id === data.manager_id) ?? d.manager,
            director: _users.find(u => u.id === data.director_id)?? d.director,
            vp:       _users.find(u => u.id === data.vp_id)      ?? d.vp,
          }
        : d
    )
    return { error: null }
  }
  return supabase.from('deals').update(data).eq('id', id)
}

export async function deleteDeal(id) {
  if (DEMO_MODE) {
    _deals = _deals.filter(d => d.id !== id)
    return { error: null }
  }
  return supabase.from('deals').delete().eq('id', id)
}

// ── Users / Profiles ──────────────────────────────────────────
export async function fetchUsers() {
  if (DEMO_MODE) return { data: _users, error: null }
  return supabase.from('profiles').select('*').order('name')
}

export async function updateUser(id, data) {
  if (DEMO_MODE) {
    _users = _users.map(u => u.id === id ? { ...u, ...data } : u)
    return { error: null }
  }
  const { password, ...rest } = data
  return supabase.from('profiles').update(rest).eq('id', id)
}

export async function deleteUser(id) {
  if (DEMO_MODE) {
    _users = _users.filter(u => u.id !== id)
    return { error: null }
  }
  return supabase.from('profiles').delete().eq('id', id)
}

// ── Payments ──────────────────────────────────────────────────
export async function fetchPayments() {
  if (DEMO_MODE) return { data: _payments, error: null }
  return supabase.from('payments').select(
    '*, deal:deal_id(deal_name), user:user_id(name)'
  ).order('pay_date', { ascending: false })
}

export async function deletePayment(id) {
  if (DEMO_MODE) {
    _payments = _payments.filter(p => p.id !== id)
    return { error: null }
  }
  return supabase.from('payments').delete().eq('id', id)
}
