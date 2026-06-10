import { useState, useEffect } from 'react'
import { useSettings } from '../contexts/SettingsContext'

// Site logo, in priority order:
//   1. The logo uploaded in Admin → Settings (app_settings.site_logo data URL)
//   2. /logo.png from the public/ folder, if someone added one to the repo
//   3. A clean "TT" monogram badge (never shows broken)
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

  // Clean monogram fallback — only shows when no logo has been uploaded.
  return (
    <div
      className="rounded-lg flex items-center justify-center flex-shrink-0 font-bold tracking-tight"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg, #0e3b35, #145247)',
        border: '1px solid #1c5a50',
        color: '#2dd4bf',
        fontSize: Math.round(size * 0.42),
      }}
    >
      TT
    </div>
  )
}
