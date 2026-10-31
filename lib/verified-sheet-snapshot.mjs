/** Isolated read-only Sheet transport. Never reads/writes the dashboard cache.
 * One abort deadline covers token acquisition, fetch and JSON parsing. No
 * retries or stale fallback: the caller must fail the run if this read fails.
 */
export async function readVerifiedSheetSnapshot({sheetId,getToken,parseTab,fetchImpl=fetch,timeoutMs=30000,now=Date.now}) {
  if (typeof sheetId!=='string' || !/^[A-Za-z0-9_-]+$/.test(sheetId)) throw Error('verified Sheet ID unavailable')
  if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000) throw Error('invalid Sheet read timeout')
  const controller=new AbortController()
  let timer
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('verified Sheet read timeout'))},timeoutMs)})
  const operation=(async()=>{
    const token=await getToken(controller.signal)
    if (controller.signal.aborted) throw Error('verified Sheet read timeout')
    const query=['Jobs','Schedule'].map(t=>`ranges=${encodeURIComponent(t)}`).join('&')
    const response=await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${query}&majorDimension=ROWS`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,redirect:'manual'})
    if (!response.ok) throw Error('verified Sheet read rejected')
    const body=await response.json()
    if (controller.signal.aborted) throw Error('verified Sheet read timeout')
    if (!Array.isArray(body.valueRanges) || body.valueRanges.length!==2) throw Error('verified Sheet tabs incomplete')
    const tabs={}
    for(const range of body.valueRanges){
      const name=String(range?.range||'').split('!')[0].replace(/^'|'$/g,'')
      if (!['Jobs','Schedule'].includes(name) || tabs[name] || !Array.isArray(range.values) || range.values.length<2 || !range.values.every(Array.isArray)) throw Error('verified Sheet tabs incomplete')
      tabs[name]=parseTab(range.values)
    }
    if (!tabs.Jobs || !tabs.Schedule) throw Error('verified Sheet tabs incomplete')
    return {data:{jobs:tabs.Jobs,schedule:tabs.Schedule},fetchedAt:new Date(now()).toISOString()}
  })()
  try{return await Promise.race([operation,deadline])}
  finally{clearTimeout(timer);controller.abort()}
}
