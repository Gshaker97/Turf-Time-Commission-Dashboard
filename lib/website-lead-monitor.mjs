import crypto from 'node:crypto'

export const LAUNCH = '2026-10-30T00:00:00-07:00'
const HOUR = 3600000
const BASELINE = new Set(['IDDYLNFBVenh57oxDAXf', 'zdZWqv4Sox6NVwLjr0HC', 'IRS4EmPFi5bcI98XEfjB'])
const BASELINE_AT = Date.parse('2026-11-03T20:47:45Z')
const text = x => typeof x === 'string' ? x.trim() : ''
const norm = x => text(x).toLowerCase().replace(/[^a-z0-9]/g, '')
const email = x => text(x).toLowerCase()
const phone = x => text(x).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
const street = /\b\d{1,6}\s+(?:[NSEW]\.?(?:\s+|(?=[A-Za-z])))?[A-Za-z0-9][A-Za-z0-9 .'’\-]{0,75}?\s(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|way|place|pl|trail|trl|circle|cir|boulevard|blvd|terrace|ter|parkway|pkwy|pass|loop|glen|gln)\b/i
export function projectIdentity(x, fallback='') {
  const value=text(x),m=value.match(street)
  if(!m)return null
  const canonical=m[0].toLowerCase().replace(/\b(north|south|east|west)\b/g,w=>w[0]).replace(/\b(street|road|avenue|drive|lane|court|place|trail|circle|boulevard|terrace|parkway|glen)\b/g,w=>({street:'st',road:'rd',avenue:'ave',drive:'dr',lane:'ln',court:'ct',place:'pl',trail:'trl',circle:'cir',boulevard:'blvd',terrace:'ter',parkway:'pkwy',glen:'gln'})[w]).replace(/[^a-z0-9]/g,'')
  let tail=value.slice(m.index+m[0].length)
  const unit=tail.match(/^\s*,?\s*(?:(?:apt|apartment|unit|suite|ste)\.?\s*|#\s*)([a-z0-9-]+)/i)
  if(unit)tail=tail.slice(unit[0].length)
  const zip=tail.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1]||(/^\d{5}$/.test(fallback)?fallback:null)
  const city=tail.match(/^\s*,?\s*([a-z .'-]+?)(?:,\s*|\s+)(?:az|arizona)\b/i)?.[1]||(!zip&&/^[a-z .'-]+$/i.test(fallback)?fallback:null)
  return {street:canonical,unit:unit?norm(unit[1]):null,zip,city:city?norm(city):null}
}
export function projectAddress(x) {const p=projectIdentity(x);return p?p.street+(p.unit?'unit'+p.unit:''):null}
function projectConflict(a,b){return !!(a&&b&&(a.street!==b.street||a.unit!==b.unit||a.zip&&b.zip&&a.zip!==b.zip||a.city&&b.city&&a.city!==b.city))}
function field(body, name) { return text(body.match(new RegExp('^' + name + ': ([^\\n]*)', 'm'))?.[1]).replace(/^[-–—]$/, '') }
function submittedTime(body, note) {
  // The final generated Received line cannot be replaced by text inside Message.
  const matches=[...body.matchAll(/^Received: (\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) \(Arizona\)\s*$/gm)]
  let value=null
  if(matches.length){const m=matches.at(-1),hour=Number(m[4])%12+(m[7]==='PM'?12:0)
    if(Number(m[4])<1||Number(m[4])>12||Number(m[5])>59||Number(m[6])>59)return null
    const day=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
    if(!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)return null
    value=day+`T${String(hour).padStart(2,'0')}:${m[5]}:${m[6]}-07:00`
  } else {
    // New format puts Submitted before Name, outside customer-controlled Message.
    value=body.match(/^Website estimate request\s*\n\s*Submitted: [^\n]*\| UTC: (\d{4}-\d{2}-\d{2}T[^\s]+Z)\s*\nName:/)?.[1]||null
  }
  const ms=Date.parse(value),created=Date.parse(note.dateAdded)
  if(!Number.isFinite(ms)||!Number.isFinite(created)||Math.abs(ms-created)>60000)return null
  return new Date(ms).toISOString()
}
export function parseRequest(note, contactId, locationId) {
  const body = text(note.body)
  if (!/^Website estimate request\s*\n/.test(body)) return null
  const message = text(body.match(/^Message: ([\s\S]*?)(?=\nPage:|\nPromotional SMS|(?![\s\S]))/m)?.[1]).replace(/^[-–—]$/, '')
  const cityOrZip = field(body, 'City or ZIP')
  const explicitTest = /\bnot a customer estimate request\b|\bcontrolled website (?:launch )?(?:verification|test)\b/i.test(message) || /^TEST\s*[—:-].*no physical project/i.test(cityOrZip)
  const submittedAt = submittedTime(body,note)
  const supplied = field(body, 'Project address')
  const embedded = message.match(street)
  const address = supplied || (embedded ? text(message.slice(embedded.index).split(/[\n!?]/)[0]).slice(0,200) : '')
  const projectKey = projectAddress(address)
  return {
    contactId, noteId: text(note.id), name: field(body,'Name'), phone: field(body,'Phone'), email: field(body,'Email'),
    submittedAddress: address, addressOrigin: supplied ? 'project_address' : embedded ? 'message' : null,
    cityOrZip, projectKey, projectIdentity:projectIdentity(address,cityOrZip), submittedAt, service: field(body,'Interested in'), message, referralSource: field(body,'How they found us'),
    sourceUrl: field(body,'Page'), recordUrl: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contactId)}`,
    explicitTest,
  }
}
const evidence = a => ({id:a.id,contactId:a.contactId||a.ghlContactId||null,opportunityId:a.opportunityId||a.ghlOpportunityId||null,name:a.customerName||a.title||null,startAt:a.startAt,status:a.status??null,rep:a.rep?.name||null,createdAt:a.createdAt||null,updatedAt:a.updatedAt||null})
const canceled = a => /CANCEL|RESCHEDUL|DELET/.test([a.status,a.secondaryStatus].filter(Boolean).join(' ').toUpperCase())
const uncertainStatus = a => /WENT_WITH|NOT_INTERESTED|WANTS_MORE|NO_SHOW|FOLLOW_UP/.test(String(a.status||'').toUpperCase())
export function classify(request, appointments, now) {
  const aliases=request.identityAliases||{contacts:[request.contactId],phones:[request.phone],emails:[request.email],names:[request.name],opportunities:request.opportunityIds||[]}
  const ps=aliases.phones.map(phone).filter(p=>p.length===10),es=aliases.emails.map(email).filter(Boolean),ns=aliases.names.map(norm).filter(Boolean)
  const possible = []
  for (const a of appointments) {
    const ids = [a.contactId,a.ghlContactId].filter(Boolean)
    const opportunityMatch=aliases.opportunities.includes(a.opportunityId||a.ghlOpportunityId)
    const idMatch = ids.some(id=>aliases.contacts.includes(id)) || opportunityMatch
    const phoneMatch = ps.includes(phone(a.customerPhone))
    const emailMatch = es.includes(email(a.customerEmail))
    const addr = projectIdentity(a.customerAddress || a.location)
    const addressMatch = !!addr && addr.street === request.projectIdentity.street && addr.unit === request.projectIdentity.unit && !projectConflict(addr,request.projectIdentity)
    const nameMatch = [a.customerName,a.title].some(v=>ns.includes(norm(v)))
    if (!(idMatch||phoneMatch||emailMatch||addressMatch||nameMatch)) continue
    const conflict = projectConflict(addr,request.projectIdentity)
    const strong = (idMatch||phoneMatch||emailMatch||addressMatch&&nameMatch) && !conflict && (!request.multipleProjects||addressMatch||opportunityMatch)
    const reasons = [idMatch&&'contact_id',phoneMatch&&'phone',emailMatch&&'email',addressMatch&&'address',nameMatch&&'name'].filter(Boolean)
    possible.push({...evidence(a),matches:reasons,strong,conflictingProject:conflict,canceled:canceled(a),uncertainStatus:uncertainStatus(a)})
  }
  const current = possible.filter(a=>a.strong && Date.parse(a.startAt)>=Date.parse(request.submittedAt))
  const active = current.filter(a=>!a.canceled&&!a.uncertainStatus)
  if (active.length) return {status:'scheduled',reason:'matching_estimator_appointment_after_submission',matchEvidence:active}
  if (possible.length) return {status:'review_needed',reason:current.some(a=>a.canceled)?'canceled_or_rescheduled_only':current.some(a=>a.uncertainStatus)?'booking_requires_follow_up':possible.some(a=>a.conflictingProject)?'matching_identity_different_project':'historical_or_ambiguous_match',matchEvidence:possible}
  return {status:now-Date.parse(request.submittedAt)>12*HOUR?'missing_after_12h':'within_grace',reason:'no_matching_estimator_appointment_in_complete_window',matchEvidence:[]}
}
export function buildReport({requests,calendar,coverage,now=Date.now()}) {
  const errors = [...(coverage.errors||[])]
  const generated = Date.parse(calendar?.generatedAt)
  const window = calendar?.window
  const appointments = calendar?.appointments
  if (!Array.isArray(appointments)||!window||!Number.isFinite(generated)||Math.abs(now-generated)>5*60000||calendar.error||calendar.partial||calendar.complete===false) errors.push('calendar_incomplete_or_stale')
  if (Array.isArray(appointments) && appointments.some(a=>!a.id||!Number.isFinite(Date.parse(a.startAt)))) errors.push('invalid_appointment')
  if (!window || !/^\d{4}-\d{2}-\d{2}$/.test(window.from||'') || !/^\d{4}-\d{2}-\d{2}$/.test(window.appointmentsTo||'') || !Number.isFinite(Date.parse(window.from)) || !Number.isFinite(Date.parse(window.appointmentsTo)) || Date.parse(window.from)>now || Date.parse(window.appointmentsTo)<now+119*24*HOUR || window.ahead!==120 || window.months!==6) errors.push('calendar_window_incomplete')
  if (!Number.isSafeInteger(calendar?.summary?.appointments) || calendar.summary.appointments!==appointments?.length || !Number.isSafeInteger(calendar?.summary?.upcoming) || calendar.summary.upcoming!==appointments?.filter(a=>a.isUpcoming===true).length || Array.isArray(appointments)&&new Set(appointments.map(a=>a.id)).size!==appointments.length) errors.push('calendar_count_mismatch')
  const groups = [], excluded = {explicitTests:0,noProjectAddress:0,beforeLaunch:0}, review = []
  for (const r of requests) {
    if (r.explicitTest) { excluded.explicitTests++; continue }
    if (r.submittedAt && Date.parse(r.submittedAt)<Date.parse(LAUNCH)) {excluded.beforeLaunch++;continue}
    if (!r.projectKey) {excluded.noProjectAddress++;continue}
    if (!r.submittedAt || Date.parse(r.submittedAt)>now+60000) {review.push({...r,status:'review_needed',reason:'original_submission_time_unavailable_or_invalid',matchEvidence:[]});continue}
    const sameIdentity=x=>x.contactId===r.contactId || phone(r.phone).length===10&&phone(x.phone)===phone(r.phone) || email(r.email)&&email(x.email)===email(r.email)
    const possible=groups.filter(rs=>rs.some(x=>sameIdentity(x)&&x.projectKey===r.projectKey&&!projectConflict(x.projectIdentity,r.projectIdentity)))
    const compatible=possible.every(rs=>rs.every(x=>!projectConflict(x.projectIdentity,r.projectIdentity))) && possible.flat().every(x=>possible.flat().every(y=>!projectConflict(x.projectIdentity,y.projectIdentity)))
    if(!compatible){for(const rs of possible)for(const x of rs)x.groupAmbiguous=true;groups.push([{...r,groupAmbiguous:true}]);continue}
    const matching=possible
    const merged=[{...r},...matching.flat()]
    for(const group of matching)groups.splice(groups.indexOf(group),1)
    groups.push(merged)
  }
  const complete = coverage.complete===true && errors.length===0
  const leads = groups.map(rs=>{
    rs.sort((a,b)=>Date.parse(a.submittedAt)-Date.parse(b.submittedAt))
    const r=rs[0],ageSeconds=Math.max(0,Math.floor((now-Date.parse(r.submittedAt))/1000))
    const identityAliases={contacts:[...new Set(rs.map(x=>x.contactId))],phones:[...new Set(rs.map(x=>x.phone))],emails:[...new Set(rs.map(x=>x.email).filter(Boolean))],names:[...new Set(rs.map(x=>x.name))],opportunities:[...new Set(rs.flatMap(x=>x.opportunityIds||[]))]}
    const noticeKey='website-estimate-v1:'+crypto.createHash('sha256').update(r.contactId+'|'+r.projectKey+'|'+r.submittedAt).digest('hex')
    const baseline=rs.some(x=>BASELINE.has(x.contactId)&&Date.parse(x.submittedAt)<=BASELINE_AT)
    const multipleProjects=groups.some(other=>other!==rs&&other.some(x=>identityAliases.contacts.includes(x.contactId)||identityAliases.phones.map(phone).includes(phone(x.phone))||x.email&&identityAliases.emails.map(email).includes(email(x.email))))
    const calendarRangeCovered=complete&&Date.parse(window.from)<=Date.parse(r.submittedAt)
    const result=complete?( !calendarRangeCovered?{status:'source_incomplete',reason:'submission_precedes_calendar_window',matchEvidence:[]}:rs.some(x=>x.groupAmbiguous)?{status:'review_needed',reason:'ambiguous_project_grouping',matchEvidence:[]}:classify({...r,identityAliases,multipleProjects},appointments,now)):{status:'source_incomplete',reason:'absence_conclusion_suppressed',matchEvidence:[]}
    const {projectKey,projectIdentity,explicitTest,groupAmbiguous,...publicRequest}=r
    return {...publicRequest,submissionCount:rs.length,lastSubmittedAt:rs.at(-1).submittedAt,ageSeconds,overdueSeconds:Math.max(0,ageSeconds-12*3600),noticeKey,previouslyNotifiedBaseline:baseline,calendarRangeCovered,...result,notifyEligible:complete&&calendarRangeCovered&&result.status==='missing_after_12h'&&!baseline}
  })
  for (const r of review) {const {projectKey,projectIdentity,explicitTest,...row}=r;leads.push({...row,notifyEligible:false})}
  return {schemaVersion:1,ok:complete,readOnly:true,generatedAt:new Date(now).toISOString(),status:complete?'complete':'source_incomplete',coverage:{...coverage,errors:[...new Set(errors)],calendar:{generatedAt:calendar?.generatedAt||null,window:window||null,total:calendar?.summary?.appointments??null,returned:Array.isArray(appointments)?appointments.length:0,includesCanceled:true,includesFuture:true,stableGhlIdsAvailable:Array.isArray(appointments)&&appointments.some(a=>a.contactId||a.ghlContactId||a.opportunityId||a.ghlOpportunityId)}},excluded,leads,notificationCandidates:leads.filter(r=>r.notifyEligible).map(r=>r.noticeKey)}
}

export async function collectWebsiteRequests({getGhl,locationId,signal,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const requests=[],errors=[],seenPages=new Set(),seenContacts=new Set(),candidates=[]
  let path=`/contacts/?locationId=${encodeURIComponent(locationId)}&limit=100`,pages=0,total=null
  while(path&&pages<200) {
    signal?.throwIfAborted()
    if(seenPages.has(path)) {errors.push('contacts_pagination_loop');break}
    seenPages.add(path)
    const d=await getGhl(path,signal)
    if(!Array.isArray(d.contacts)||!d.meta||!Number.isSafeInteger(d.meta.total)) throw Error('invalid_contacts_page')
    if(total!==null&&total!==d.meta.total)errors.push('contact_total_changed_during_read')
    total=d.meta.total
    for(const c of d.contacts){if(!c.id||seenContacts.has(c.id)) {errors.push('duplicate_or_invalid_contact');continue}seenContacts.add(c.id);if(c.tags?.includes('website')||c.tags?.includes('estimate-request')||/^Website(?: ·|$)/.test(c.source||'')) candidates.push(c)}
    pages++
    const next=d.meta.nextPageUrl
    path=null
    if(next){const u=new URL(next);if(u.origin!=='https://services.leadconnectorhq.com'||u.pathname!=='/contacts/'||u.searchParams.get('locationId')!==locationId)throw Error('invalid_contacts_cursor');path=u.pathname+u.search}
    if(path)await pause(220)
  }
  if(path)errors.push('contacts_page_limit')
  if(seenContacts.size!==total)errors.push('contacts_count_mismatch')
  if(candidates.length>500)throw Error('candidate_limit')
  let notesRead=0
  for(const c of candidates){signal?.throwIfAborted();const d=await getGhl(`/contacts/${encodeURIComponent(c.id)}/notes`,signal);if(!Array.isArray(d.notes)||d.meta?.nextPageUrl||d.partial)throw Error('notes_incomplete');notesRead++;for(const note of d.notes){const r=parseRequest(note,c.id,locationId);if(r){r.opportunityIds=[...new Set(d.notes.filter(n=>Math.abs(Date.parse(n.dateAdded)-Date.parse(note.dateAdded))<120000).map(n=>text(n.body).match(/^Website estimate request PDF for opportunity ([A-Za-z0-9]+):/)?.[1]).filter(Boolean))];requests.push(r)}}await pause(220)}
  return {requests,coverage:{complete:errors.length===0,errors,contacts:{pages,total,scanned:seenContacts.size,candidates:candidates.length,notesRead},submissionWindow:{from:LAUNCH,scope:'stored original Website estimate request notes on all currently retained contacts with website/estimate-request tags or relay Website source',limits:['deleted contacts or notes cannot be reconstructed','pre-launch previews outside scope','earliest original submission retained for each contact/project; repeated submissions do not reset grace clock']}}}
}

export function createMonitor({load,now=Date.now,ttl=5*60000}) {
  let state={phase:'idle',at:0,report:null},running=null
  return {read(){
    const fresh=now()-state.at<ttl
    if(state.report&&fresh)return {status:state.report.ok?200:503,body:state.report}
    if(state.phase==='failed'&&fresh)return {status:503,body:{schemaVersion:1,ok:false,readOnly:true,status:'source_incomplete',error:'upstream_read_failed',notificationCandidates:[]}}
    if(!running){state.phase='building';running=Promise.resolve().then(load).then(report=>{state={phase:'ready',at:now(),report}}).catch(()=>{state={phase:'failed',at:now(),report:null}}).finally(()=>{running=null})}
    return {status:202,body:{schemaVersion:1,ok:false,readOnly:true,status:'building',retryAfterSeconds:10,notificationCandidates:[]}}
  },async settled(){await running}}
}
