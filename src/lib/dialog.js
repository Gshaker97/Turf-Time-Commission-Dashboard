// ============================================================
// Promise-based dialogs — the replacement for window.confirm / window.prompt.
//
// Same bus pattern as toast.js: fire an event, <DialogHost/> (mounted once in
// Layout) renders it and resolves the promise with the answer. Every call is
// a near drop-in for the native version:
//
//   if (!await confirmDialog({ title: 'Delete this deal?' })) return
//   const why = await promptDialog({ title: 'Hide this deal?', label: 'Reason' })
//   if (why === null) return                     // cancelled, exactly like prompt()
//   await revealDialog({ title: 'Login created', value: password })
//
// WHY: the browser's own dialogs can't be styled, show the page's hostname,
// render \n-joined paragraphs as one grey wall, and block the whole tab. They
// carry the most consequential actions on the site — deleting a deal, paying
// 19 people, overriding a locked pay run — and looked like a 1998 error box.
//
// Outside a browser (tests, SSR) every call resolves to the cancel answer
// rather than throwing, so engine code can import this file safely.
// ============================================================

const ask = (detail) => new Promise((resolve) => {
  try {
    window.dispatchEvent(new CustomEvent('tt-dialog', { detail: { ...detail, resolve } }))
  } catch {
    resolve(detail.kind === 'confirm' ? false : null)
  }
})

/**
 * Yes/no. Resolves true when confirmed, false on cancel / Esc / backdrop.
 * @param {object} o
 * @param {string} o.title      The question. One line, no trailing colon.
 * @param {string} [o.message]  A sentence of context under the title.
 * @param {string[]} [o.bullets] Consequences, one per line, rendered as a list.
 * @param {string} [o.confirmLabel='Confirm']
 * @param {string} [o.cancelLabel='Cancel']
 * @param {'default'|'danger'|'warn'} [o.tone='default'] Colours the confirm button.
 */
export const confirmDialog = (o) => ask({ ...o, kind: 'confirm' })

/**
 * Ask for a line of text. Resolves the string (possibly ''), or NULL when
 * cancelled — the same contract as window.prompt, so call sites keep their
 * `if (x === null) return` guard.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.message]
 * @param {string[]} [o.bullets]
 * @param {string} [o.label]        Field label, e.g. 'Reason (optional)'.
 * @param {string} [o.placeholder]
 * @param {string} [o.defaultValue='']
 * @param {boolean} [o.required]    Blocks confirm until something is typed.
 * @param {boolean} [o.multiline]   Renders a textarea instead of an input.
 * @param {string} [o.confirmLabel='Save']
 * @param {'default'|'danger'|'warn'} [o.tone='default']
 */
export const promptDialog = (o) => ask({ ...o, kind: 'prompt' })

/**
 * Show a value the user needs to copy (a generated password, a link). One
 * button, plus Copy. Resolves when dismissed. This replaces the old
 * window.prompt-as-a-clipboard trick, which looked like it was asking a
 * question it had no intention of reading.
 */
export const revealDialog = (o) => ask({ ...o, kind: 'reveal' })

/** A message with a single OK — for anything that must be acknowledged. */
export const alertDialog = (o) => ask({ ...o, kind: 'alert' })

/**
 * Pick one of several named actions. Resolves the chosen option's `key`, or
 * NULL if dismissed.
 *
 * This exists because a window.confirm cannot ask a three-way question, and
 * two places were pretending otherwise: "OK = email an invite, Cancel = set a
 * password by hand" meant pressing Esc CREATED A PASSWORD. Backing out has to
 * be its own answer whenever both buttons do something.
 *
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.message]
 * @param {{key:string,label:string,description?:string,tone?:'default'|'danger'|'warn'}[]} o.options
 *   Listed in order; the first is the recommended one.
 */
export const choiceDialog = (o) => ask({ ...o, kind: 'choice' })
