// Tiny toast bus — replaces blocking alert() popups. Fire from anywhere:
//   toast.error('Could not save: ...')   red, sticks around 10s
//   toast.info('Profile created')        neutral, 7s
//   toast.success('Saved')               teal, 5s
// Rendered by <Notices/> in Layout. Safe to call outside the browser (no-op).
export function toast(message, type = 'info') {
  try {
    window.dispatchEvent(new CustomEvent('tt-toast', { detail: { message: String(message), type } }))
  } catch { /* non-browser context */ }
}
toast.error   = (m) => toast(m, 'error')
toast.info    = (m) => toast(m, 'info')
toast.success = (m) => toast(m, 'success')
