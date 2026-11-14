// Redesign step 8: which regions of the admin-side pages hold WRITE logic.
// Shared by the test (reads the branch file) and the one-off fixture
// generator (read the same regions from origin/main). A block is
// [startMarker, endMarker]; the end is the first occurrence after the start,
// and `null` means "to the end of the file". Everything between markers is
// handlers, payload builders and Supabase calls — never markup.
export const SPEC = [
  {
    file: 'src/pages/Payroll.jsx', fixture: 'payroll',
    blocks: [
      ['const todayISO = () =>', 'function Card({ label'],
      ['// Per-deal payout breakdown', '// Ratio (e.g. 0.2'],
      ['const asPct = (ratio)', '  // ── Where this run is in its life'],
      ['  // The three deal-level problems', '\n  return (\n'],
    ],
    writers: ['async function saveAddPay', 'async function saveAdjustment', 'async function removeAdjustment',
      'async function saveDeduction', 'async function applyDeduction', 'async function writeOff', 'async function reopen',
      'async function deleteDebt', 'async function lockRun', 'async function unlockRun', 'async function setStatus',
      'async function markAll', 'async function handleSave', 'function exportCsv', 'async function copyPayee', 'Pay Statement'],
  },
  {
    file: 'src/components/DeductionModal.jsx', fixture: 'deduction-modal',
    blocks: [
      ['const money = (v) =>', 'export default function DeductionModal('],
      ['  const [q, setQ]', '  // Their whole cheque on that run'],
    ],
    writers: ['async function save', 'const splitRows', 'const canSave', 'onSave({'],
  },
  {
    file: 'src/pages/ImportDeals.jsx', fixture: 'import-deals',
    blocks: [['const FIELDS = [', '  const hasTable =']],
    writers: ['async function runImport', 'insertDeal(payload', 'function parseDelimited', 'const parseMoney', 'const parseDate'],
  },
  {
    file: 'src/pages/Admin.jsx', fixture: 'admin',
    blocks: [
      ['const agoText = (iso)', 'function HealthRow('],
      ['export default function Admin() {', "They may still be able to sign in until fixed.')"],
      ['  const [showLog, setShowLog]', '\n  return (\n'],
    ],
    writers: ['async function saveUser', 'async function handleDeleteUser', 'async function patchUser', 'async function createLogin',
      'async function resetLogin', 'async function toggleActive', 'async function moveUser', 'function renameTeam',
      'async function submitMove', 'async function cancelScheduled', 'async function editChangeDate', 'async function removeChange',
      'async function applyNow', 'async function sweepDueMoves'],
  },
  {
    file: 'src/components/UserModal.jsx', fixture: 'user-modal',
    blocks: [['const BLANK = {', '  const managers  = allUsers']],
    writers: ['async function setPassword', 'async function handleSubmit', "userAdmin(action, { email: form.email, password: pw })"],
  },
  {
    file: 'src/components/ManagerBackfillModal.jsx', fixture: 'manager-backfill-modal',
    blocks: [['export default function ManagerBackfillModal', '\n  return (\n']],
    writers: ['async function run', 'updateDeal(d.id, { manager_id: manager.id })'],
  },
  {
    file: 'src/components/TeamMoveModal.jsx', fixture: 'team-move-modal',
    blocks: [['export default function TeamMoveModal({', '  const datePill = (label, value)']],
    writers: ['async function submit', 'const groups', 'const canSubmit', 'const blocked', 'onSubmit?.({ groups, effectiveDate: when'],
  },
  {
    file: 'src/components/SettingsPanel.jsx', fixture: 'settings-panel',
    blocks: [
      ['const localDateISO = () =>', "import { useSettings }"],
      ['function StatusEditor() {', '\n  return (\n'],
      ['function ListEditor({', '\n  return (\n'],
      ['function stripWhiteBackground(canvas) {', '\n  return (\n'],
      ['function TextSetting({', '\n  return (\n'],
      ['function DashboardFlagsEditor() {', '\n  return (\n'],
      ['function DateSetting({', '\n  return (\n'],
      ['const LEGACY_ERA =', '  const numInp = (value, onChange'],
      ['const WEEKDAYS = [', '\n  return (\n'],
      ['function NoteNotifyEditor() {', '  const Toggle = ('],
      ['const LEAD_FIELDS = [', '\n  return (\n'],
      ['const LeadFeedEditor = () =>', 'function AddDisposition('],
      ['function AddDisposition({', '\n  return (\n'],
      ['      <LogoEditor />', null],
    ],
    writers: ["save('deal_statuses'", 'save(settingKey', "save('site_logo'", "save('perf_floors'", "save('perf_default_team'",
      "save('override_rates'", "save('pay_date_rule'", "save('note_notify'", 'save(mapKey', "save('lead_status_map'",
      'function stripWhiteBackground', 'settingKey="data_start_date"', 'settingKey="estimates_from_leads_date"'],
  },
  {
    file: 'src/pages/RequiresAudit.jsx', fixture: 'requires-audit',
    blocks: [
      ['const isKeaton = (p)', 'const fmtDate ='],
      ['export default function RequiresAudit() {', '  // Access guard'],
      ['function CorrectionModal({', '\n  return (\n'],
    ],
    writers: ['async function save', 'updateDeal(deal.id, patch)', 'insertAuditOverrides(rows)', 'const allowed = isAdmin || isKeaton(profile)'],
  },
  {
    file: 'src/pages/Login.jsx', fixture: 'login',
    blocks: [['export default function Login() {', '  const inputCls']],
    writers: ['signIn(email, password)', 'sendPasswordReset(email)'],
  },
  {
    file: 'src/pages/SetPassword.jsx', fixture: 'set-password',
    blocks: [['export default function SetPassword() {', '  const inputCls']],
    writers: ['updateOwnPassword(pwd)', 'pwd.length < 8', 'pwd !== pwd2'],
  },
]

export function block(s, start, end) {
  const i = s.indexOf(start)
  if (i < 0) throw new Error(`missing marker: ${start}`)
  if (end === null) return s.slice(i)
  const j = s.indexOf(end, i + start.length)
  if (j < 0) throw new Error(`missing marker: ${end}`)
  return s.slice(i, j)
}
export const extract = (src, blocks) => blocks.map(([a, b]) => block(src, a, b)).join('\n// ──── next block ────\n')
