import { useState, useEffect } from 'react'
import { useSettings } from '../contexts/SettingsContext'

// Site logo, in priority order:
//   1. The logo uploaded in Admin → Settings (app_settings.site_logo data URL)
//   2. /logo.png from the public/ folder, if someone added one to the repo
//   3. The built-in turf-blades mark (never shows broken)
// The login screen renders pre-sign-in, so it can't read settings — there it
// goes straight to #2/#3.
export default function Logo({ size = 28 }) {
  const { settings } = useSettings()
  const uploaded = settings?.site_logo || null
  const src = uploaded || '/logo.png'
  const [missing, setMissing] = useState(false)
  useEffect(() => { setMissing(false) }, [src])   // re-try when the logo changes

  if (!missing) {
    return (
      <img
        src={src}
        alt="Turf Time"
        width={size}
        height={size}
        className="rounded-lg object-contain flex-shrink-0"
        onError={() => setMissing(true)}
      />
    )
  }

  return (
    <div
      className="rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg"
      style={{ width: size, height: size, background: '#0f1a0f', border: '1px solid #2a4a2a' }}
    >
      <svg viewBox="0 0 20 20" fill="none" width={size * 0.58} height={size * 0.58}>
        <path d="M10 18 C10 14 7 9 8 3 C8.5 1.5 10 2 10.5 3.5 C10 8 10 13 10 18Z" fill="#4ade80" />
        <path d="M10 18 C10 14 13 9 12.5 4 C12 2 10.5 2 10.5 3.5 C11 8 10.5 13 10 18Z" fill="#22c55e" />
      </svg>
    </div>
  )
}
