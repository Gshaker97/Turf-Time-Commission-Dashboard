import { useEffect, useRef } from 'react'

// Re-runs `refresh` whenever the tab/window regains focus, so stat views repull
// the latest deal/user data (e.g. after a deal is edited elsewhere or the
// scheduler imports new jobs) without a manual reload. Keeps a stable listener
// while always calling the latest callback.
export function useRefreshOnFocus(refresh) {
  const ref = useRef(refresh)
  ref.current = refresh
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) ref.current?.() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])
}
