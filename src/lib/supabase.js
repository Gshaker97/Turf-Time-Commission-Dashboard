import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const DEMO_MODE = !url || !key || url === 'https://your-project-id.supabase.co'

export const supabase = DEMO_MODE
  ? null
  : createClient(url, key)
