import test from 'node:test'
import assert from 'node:assert/strict'
import {validatePrivatePolicy} from '../lib/verified-sheet-policy.mjs'
const good=()=>({version:'synthetic-test',policyApproved:true,existingHoldsPreserved:true,reviewedProjectCount:228,scope:Array.from({length:228},(_,i)=>({projectId:String(i+1),opportunityId:'synthetic'+i,fieldHolds:{}})),approvedPlanHashes:[]})
test('private policy absent or empty defaults closed',()=>{assert.throws(()=>validatePrivatePolicy(null));assert.throws(()=>validatePrivatePolicy({scope:[]}))})
test('only approved full synthetic exact-ID policy accepted',()=>{assert.equal(validatePrivatePolicy(good()).scope.length,228);const p=good();p.existingHoldsPreserved=false;assert.throws(()=>validatePrivatePolicy(p))})
test('duplicate and unresolved identities held',()=>{const p=good();p.scope[1]=p.scope[0];assert.throws(()=>validatePrivatePolicy(p));const q=good();q.scope[0].opportunityId='UNRESOLVED';assert.throws(()=>validatePrivatePolicy(q));q.scope[0].hold='identity hold';assert.equal(validatePrivatePolicy(q).scope.length,228)})
test('unsupported field approvals rejected',()=>{const p=good();p.approvedPlanHashes=['anything'];assert.throws(()=>validatePrivatePolicy(p));const q=good();q.scope[0].fieldHolds={installDate:'not a writer field'};assert.throws(()=>validatePrivatePolicy(q))})
