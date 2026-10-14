// ============================================================
// One write path for deals that may sit on a LOCKED pay run.
//
// The lock is a DB trigger (`guard_locked_payroll()`), so a rejection can
// only be discovered by attempting the write. Rather than make every page
// know about payroll locks up front, every deal write goes through here:
// try it, and if the LOCK is what refused it, offer the admin the override
// (migration 057) right where they are, with a reason box.
//
// Non-admins, and every other kind of failure, come back untouched — this
// adds no permission of its own. The DB re-checks the caller is an admin,
// insists on the reason and logs the override; that is the real gate.
// ============================================================
import { updateDeal, overrideLockedDeal } from './db'
import { promptDialog } from './dialog'

// The trigger's own wording, from migrations 028/034/039/056/057:
//   "Pay run 2026-10-02 is locked — unlock it on the Payroll page first"
//   "Pay run 2026-10-02 is locked — a deal cannot be finalized onto it; …"
export const isLockError = (err) => /pay run .* is locked/i.test(String(err?.message ?? ''))

/**
 * Update a deal, offering an admin the locked-run override if the lock bites.
 *
 * @returns {{data?, error?, overridden?: boolean, cancelled?: boolean}}
 *   `overridden` — it saved, but only because the admin forced it.
 *   `cancelled`  — the lock refused it and the admin declined to override;
 *                  `error` is still set, so callers should resync, but they
 *                  should NOT shout about it (the user just said no).
 */
export async function saveDealFields(id, patch, opts = {}) {
  const { isAdmin = false, payDate = null, what = 'this change', dealName = 'this deal' } = opts
  const res = await updateDeal(id, patch)
  if (!res?.error || !isLockError(res.error) || !isAdmin) return res

  const reason = await promptDialog({
    kind: 'prompt',
    tone: 'warn',
    title: 'This deal is on a locked pay run',
    message: payDate
      ? `${dealName} was paid out on the ${payDate} run, which is locked. As an admin you can push ${what} through anyway.`
      : `${dealName} is on a locked pay run. As an admin you can push ${what} through anyway.`,
    bullets: [
      'The rest of the run stays locked — this does not unlock it.',
      'The override is logged against the run with your name and this reason.',
      "If the payout itself was wrong, unlock the run on the Payroll page instead so the run's totals are recalculated.",
    ],
    label: 'Why are you overriding the lock?',
    placeholder: 'e.g. sheet re-sign — baseline corrected after payout',
    required: true,
    multiline: true,
    confirmLabel: 'Override the lock',
  })
  if (reason === null) return { ...res, cancelled: true }

  const out = await overrideLockedDeal(id, patch, reason)
  return out?.error ? out : { ...out, overridden: true }
}
