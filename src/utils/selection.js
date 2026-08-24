// Lots of the site's rows are clickable (expand a team, drill into a deal),
// but their numbers still need to be copyable. index.css re-enables text
// selection inside buttons; this guard keeps a drag-to-select from ALSO
// firing the row's click when the pointer comes up.
//
//   <button onClick={onClickUnlessSelecting(() => toggle(id))}>
export const onClickUnlessSelecting = (fn) => (e) => {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  // A real selection that lives inside the element just clicked = the user
  // was highlighting, not pressing.
  if (sel && !sel.isCollapsed && String(sel).trim().length > 1) {
    const node = sel.anchorNode
    if (node && e.currentTarget?.contains?.(node.nodeType === 1 ? node : node.parentNode)) return
  }
  fn?.(e)
}
