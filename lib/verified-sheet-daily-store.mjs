import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'

// No leases expire automatically. An interrupted worker/attempt remains blocked
// until an owner reviews its evidence; a restart is not permission to replay it.
const digest = value => createHash('sha256').update(String(value)).digest('hex')
export const DAILY_WORKER_KEY='verified_sheet_daily_worker'
export const dailyProjectKey=id=>'verified_sheet_daily_project_'+digest(id)
export const dailyDayKey=day=>'verified_sheet_daily_day_'+day
export function dailyCasPath(key,previous){
  if(typeof key!=='string'||!/^verified_sheet_daily_[a-zA-Z0-9_-]+$/.test(key)||typeof previous?.revision!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(previous.revision))throw Error('daily CAS identity invalid')
  return `/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&value->>revision=eq.${encodeURIComponent(previous.revision)}`
}
export function createDailyStore({read,insert,patch,uuid=randomUUID,now=()=>new Date().toISOString()}) {
  const exact = (actual,expected)=>{if(!isDeepStrictEqual(actual,expected))throw Error('daily storage read-back mismatch');return actual}
  async function putNew(key,value){if(!await insert(key,value))return false;exact(await read(key),value);return true}
  async function cas(key,previous,value){if(!await patch(key,previous,value))return false;exact(await read(key),value);return true}
  return {
    readProjectState: projectId=>read(dailyProjectKey(projectId)),
    loadJobState: projectId=>read(dailyProjectKey(projectId)),
    loadSweep: day=>read(dailyDayKey(day)),
    async acquireWorker(day,binding){
      const prior=await read(DAILY_WORKER_KEY)
      if(prior && prior.state!=='finished')return null
      const value={token:uuid(),day,...binding,state:'running',at:now(),revision:uuid()}
      const ok=prior ? await cas(DAILY_WORKER_KEY,prior,value) : await putNew(DAILY_WORKER_KEY,value)
      return ok ? value : null
    },
    async releaseWorker(token,outcome){
      const prior=await read(DAILY_WORKER_KEY)
      if(prior?.token!==token || prior.state!=='running')throw Error('daily worker identity changed')
      const value={...prior,state:outcome?.uncertain ? 'uncertain' : 'finished',outcome:{day:outcome?.day,complete:outcome?.complete,ok:outcome?.ok},finishedAt:now(),revision:uuid()}
      if(!await cas(DAILY_WORKER_KEY,prior,value))throw Error('daily worker release conflict')
      return true
    },
    async claimJob(token,entry,priorState){
      const worker=await read(DAILY_WORKER_KEY)
      if(worker?.token!==token || worker.state!=='running')throw Error('daily worker not owned')
      const key=dailyProjectKey(entry.projectId),observed=await read(key)
      if(!isDeepStrictEqual(observed,priorState))return null
      if(observed && observed.state!=='verified')return null
      const intent={...structuredClone(entry),attemptId:uuid(),workerToken:token,state:'attempting',at:now(),revision:uuid()}
      const claimed=observed ? await cas(key,observed,intent) : await putNew(key,intent)
      if(!claimed)return null
      // If this append fails, the project gate remains attempting and blocks.
      if(!await putNew('verified_sheet_daily_intent_'+intent.attemptId,intent))throw Error('daily intent conflict')
      return intent
    },
    async finishJob(intent,outcome){
      const key=dailyProjectKey(intent.projectId),prior=await read(key)
      if(!isDeepStrictEqual(prior,intent))throw Error('daily attempt identity changed')
      const value={...intent,state:outcome?.state==='verified' ? 'verified' : 'uncertain',outcome,finishedAt:now(),revision:uuid()}
      // Immutable final receipt is written before releasing the project gate.
      if(!await putNew('verified_sheet_daily_result_'+intent.attemptId,value))throw Error('daily result conflict')
      if(!await cas(key,intent,value))throw Error('daily result state conflict')
      return value
    },
    async saveSweep(day,outcome){
      const key=dailyDayKey(day),prior=await read(key)
      const value={...structuredClone(outcome),day,savedAt:now(),revision:uuid()}
      if(prior?.complete)return false
      const ok=prior ? await cas(key,prior,value) : await putNew(key,value)
      if(!ok)throw Error('daily sweep receipt conflict')
      return value
    },
  }
}
