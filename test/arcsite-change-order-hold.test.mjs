import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  classifyLaterSignature, commitPendingRevisionHold, seenEntryForHold, sweepSkipsProject,
  signNowSignedAt, sha256Pdf, totalsDiffer,
} from '../lib/arcsite-change-order-hold.mjs'

const ORIGINAL = { proposalId: '1001', total: 48760, pdfUrl: 'https://cdn.example/original.pdf', documentNumber: '1001' }
const LATER = { proposalId: '1002', total: 6420, pdfUrl: 'https://cdn.example/later.pdf', documentNumber: '1002' }
const SIGNED_TEXT = 'Customer Signature\n2026-11-02 04:15 PM UTC\nTotal $6,420.00'
const PDF_BYTES = Buffer.from('%PDF-1.7 later signature fixture')
const HASH = sha256Pdf(PDF_BYTES)

function opportunity() {
  return {
    id: 'opp-original',
    monetaryValue: 48760,
    price: 48760,
    baseline: 22000,
    markup: 18000,
    commission: 4100,
    stageId: 'ready-for-install',
    contactNewPrice: 48760,
    contactJobPrice: 48760,
    calendarNewTotal: 48760,
    pdfs: [{ url: 'https://files.example/original.pdf', name: 'original.pdf' }],
  }
}

function forbiddenIo() {
  const calls = []
  const boom = name => () => { calls.push(name); throw new Error(name + ' must not run') }
  return {
    calls,
    writeMoney: boom('writeMoney'),
    setPrice: boom('setPrice'),
    setBaseline: boom('setBaseline'),
    setMarkup: boom('setMarkup'),
    setCommission: boom('setCommission'),
    setContactPrices: boom('setContactPrices'),
    setCalendarAmount: boom('setCalendarAmount'),
    setStage: boom('setStage'),
    moveStageToClosed: boom('moveStageToClosed'),
    clearPdfs: boom('clearPdfs'),
    createOpportunity: boom('createOpportunity'),
  }
}

/** In-memory stand-in for the webhook and the sweep. Applies only the
 * effects the hold function returns. Money, stage, and calendar writers
 * are attached and must stay unused.
 */
async function runHold(location, { via, signed, incoming, listFailed = false, store = {} }) {
  const decision = classifyLaterSignature({
    projectId: location.projectId,
    existingOpportunity: { id: location.opp.id, monetaryValue: location.opp.monetaryValue },
    signedProposals: signed,
    incomingProposal: incoming,
    currentValue: location.opp.monetaryValue,
    listFailed,
  })
  const forbidden = forbiddenIo()
  const appends = []
  if (!decision.hold) return { decision, forbidden, location, store }
  const result = await commitPendingRevisionHold(decision, {
    store,
    ...forbidden,
    loadEvidence: async proposal => ({
      pdfSha256: HASH,
      signedAt: signNowSignedAt(SIGNED_TEXT, Date.parse('2026-11-12T00:00:00Z')),
      hostedUrl: `https://files.example/${proposal.proposalId}.pdf`,
      name: `contract ${proposal.proposalId}.pdf`,
      total: proposal.total,
    }),
    appendPdf: async (opportunityId, file) => {
      assert.equal(opportunityId, location.opp.id)
      assert.ok(file.url)
      location.opp.pdfs.push(file)
      appends.push(file)
    },
    saveStore: async next => { store = next },
  })
  assert.deepEqual(Object.keys(result.effects), ['appendPdfs'])
  return { decision, result, forbidden, location, store: result.store, appends, via }
}

test('SignNow timestamp is the signature stamp, and the PDF hash is the byte hash', () => {
  assert.equal(signNowSignedAt(SIGNED_TEXT, Date.parse('2026-11-12T00:00:00Z')), '2026-11-02T16:15:00.000Z')
  assert.equal(signNowSignedAt('Created 2026-11-02 04:15 PM UTC\nno signature line', Date.parse('2026-11-12T00:00:00Z')), null)
  assert.equal(HASH, sha256Pdf(PDF_BYTES))
  assert.notEqual(sha256Pdf(Buffer.from('%PDF-1.7 other')), HASH)
  assert.equal(totalsDiffer(48760, 6420), true)
  assert.equal(totalsDiffer(11262.52, 11262.53), false)
})

test('webhook: Anna-Lee-like smaller later total is held on the original contract', async () => {
  const location = { projectId: '900000000000001', opp: opportunity() }
  const before = structuredClone(location.opp)
  const { result, forbidden, location: after } = await runHold(location, { via: 'webhook', signed: [ORIGINAL, LATER], incoming: LATER })
  assert.equal(result.held, true)
  assert.equal(result.action, 'pending_revision')
  assert.equal(result.moneyWritten, false)
  assert.equal(result.stageMoved, false)
  assert.equal(result.clearedPdfs, false)
  assert.equal(result.stageWrite, null)
  assert.equal(result.opportunityId, 'opp-original')
  assert.equal(forbidden.calls.length, 0)
  assert.equal(after.opp.monetaryValue, before.monetaryValue)
  assert.equal(after.opp.price, before.price)
  assert.equal(after.opp.baseline, before.baseline)
  assert.equal(after.opp.markup, before.markup)
  assert.equal(after.opp.commission, before.commission)
  assert.equal(after.opp.contactNewPrice, before.contactNewPrice)
  assert.equal(after.opp.contactJobPrice, before.contactJobPrice)
  assert.equal(after.opp.calendarNewTotal, before.calendarNewTotal)
  assert.equal(after.opp.stageId, 'ready-for-install')
  assert.notEqual(after.opp.stageId, 'closed')
  assert.deepEqual(after.opp.pdfs.map(p => p.name), ['original.pdf', 'contract 1002.pdf'])
  const rev = result.pending.find(r => r.proposalId === '1002')
  assert.equal(rev.total, 6420)
  assert.equal(rev.pdfSha256, HASH)
  assert.equal(rev.signedAt, '2026-11-02T16:15:00.000Z')
  assert.equal(rev.status, 'pending')
  assert.equal(rev.decision, null)
  assert.equal(rev.pdfAppended, true)
  assert.equal(result.originalTotal, 48760)
})

test('sweep: same later signature does not replace money, clear PDFs, or open a second opportunity', async () => {
  const location = { projectId: '900000000000001', opp: opportunity() }
  const first = await runHold(location, { via: 'value_sweep', signed: [ORIGINAL, LATER], incoming: null })
  const pdfsAfterFirst = location.opp.pdfs.map(p => p.url)
  const second = await runHold(location, { via: 'value_sweep', signed: [ORIGINAL, LATER], incoming: null, store: first.store })
  assert.equal(second.result.held, true)
  assert.equal(second.result.pdf, 'already recorded or awaiting signed render')
  assert.deepEqual(location.opp.pdfs.map(p => p.url), pdfsAfterFirst)
  assert.equal(location.opp.pdfs[0].name, 'original.pdf')
  assert.equal(second.store['900000000000001'].revisions.filter(r => r.proposalId === '1002').length, 1)
  assert.equal(second.store['900000000000001'].opportunityId, 'opp-original')
  assert.equal(location.opp.monetaryValue, 48760)
  assert.equal(location.opp.calendarNewTotal, 48760)
  assert.equal(second.forbidden.calls.length, 0)
})

test('same-price later proposal is still pending and does not move the stage to Closed', async () => {
  const later = { ...LATER, total: 48760 }
  const location = { projectId: '900000000000002', opp: opportunity() }
  const { result } = await runHold(location, { via: 'webhook', signed: [ORIGINAL, later], incoming: later })
  assert.equal(result.pending[0].total, 48760)
  assert.equal(result.pending[0].status, 'pending')
  assert.equal(location.opp.stageId, 'ready-for-install')
  assert.equal(location.opp.monetaryValue, 48760)
  assert.equal(result.stageMoved, false)
  assert.equal(location.opp.pdfs.length, 2)
})

test('a single original proposal is not a hold, so the first contract can still sync', () => {
  const decision = classifyLaterSignature({
    projectId: '900000000000003',
    existingOpportunity: { id: 'opp-original' },
    signedProposals: [ORIGINAL],
    incomingProposal: ORIGINAL,
    currentValue: 48000,
  })
  assert.equal(decision.hold, false)
  assert.equal(decision.reason, 'original_contract')
})

test('unread proposal list with the same total blocks stage and money writes and records nothing', async () => {
  const decision = classifyLaterSignature({
    projectId: '900000000000005',
    existingOpportunity: { id: 'opp-original', monetaryValue: 48760 },
    signedProposals: [],
    incomingProposal: { ...ORIGINAL },
    currentValue: 48760,
    listFailed: true,
  })
  assert.equal(decision.hold, true)
  assert.equal(decision.reason, 'list_unread')
  assert.deepEqual(decision.later, [])
  const result = await commitPendingRevisionHold(decision, {
    store: {},
    loadEvidence: async () => { throw new Error('no pdf') },
    appendPdf: async () => { throw new Error('append') },
    saveStore: async () => {},
  })
  assert.equal(result.moneyWritten, false)
  assert.equal(result.stageMoved, false)
  assert.deepEqual(result.pending, [])
  assert.deepEqual(result.effects.appendPdfs, [])
})

test('unread proposal list and a much smaller incoming total fails closed', () => {
  const decision = classifyLaterSignature({
    projectId: '900000000000004',
    existingOpportunity: { id: 'opp-original', monetaryValue: 48760 },
    signedProposals: [],
    incomingProposal: LATER,
    currentValue: 48760,
    listFailed: true,
  })
  assert.equal(decision.hold, true)
  assert.equal(decision.reason, 'list_unread_total_disagrees')
  assert.equal(decision.later[0].proposalId, '1002')
  assert.equal(decision.later[0].total, 6420)
})

test('sweep seen-marker keeps the original value and skips only the held proposal total', () => {
  const seen = seenEntryForHold(48760, '1002', 6420)
  assert.equal(seen.t, 48760)
  assert.equal(seen.pendingTotal, 6420)
  assert.equal(seen.hold, 'pending_revision')
  assert.equal(sweepSkipsProject(seen, 6420, '1002'), true)
  assert.equal(sweepSkipsProject(seen, 7000, '1002'), false)
  assert.equal(sweepSkipsProject({ t: 6420, p: '1002' }, 6420, '1002'), true)
})

test('server webhook and sweep return the hold before any money, stage, calendar, or PDF clear', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  const webhook = server.slice(server.indexOf('async function arcsiteToGhl'), server.indexOf('const app = express()'))
  const holdReturn = webhook.indexOf("action: 'pending_revision'")
  const moneyWrite = webhook.indexOf('oppBody.monetaryValue = sellTotal')
  const stageWrite = webhook.indexOf('pipelineStageId: isChangeOrder ? pipeline.changeOrder : pipeline.closed')
  const calendar = webhook.indexOf('arcPropagateChangeOrder(')
  assert.ok(holdReturn > 0 && moneyWrite > holdReturn && stageWrite > holdReturn && calendar > holdReturn)
  assert.match(webhook.slice(0, holdReturn), /if \(decision\.hold\)/)

  const apply = server.slice(server.indexOf('async function arcApplyChangeOrder'), server.indexOf('async function arcChangeOrderForProject'))
  const applyHold = apply.indexOf('later.hold')
  const clear = apply.indexOf("field_value: ''")
  const applyMoney = apply.indexOf('monetaryValue: want')
  const applyStage = apply.indexOf('pipelineStageId: pipe.changeOrder')
  const applyCalendar = apply.indexOf('arcPropagateChangeOrder(')
  assert.ok(applyHold > 0 && clear > applyHold && applyMoney > applyHold && applyStage > applyHold && applyCalendar > applyHold)

  const sweep = server.slice(server.indexOf('async function arcValueSweep'), server.indexOf('async function arcDuplicateOppScan'))
  assert.match(sweep, /seenEntryForHold\(/)
  assert.match(sweep, /sweepSkipsProject\(/)
  assert.match(sweep, /r\.held/)

  const commit = server.slice(server.indexOf('async function arcCommitLaterSignature'), server.indexOf('async function arcApplyChangeOrder'))
  assert.match(commit, /commitPendingRevisionHold\(/)
  assert.doesNotMatch(commit, /monetaryValue|pipelineStageId|change-orders\/ingest|ghlContactSetFields|field_value: ''/)
})
