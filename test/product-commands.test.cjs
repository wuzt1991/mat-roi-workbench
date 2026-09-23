'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Commands=require('../public/product-transfer/commands.js');
const session={sessionId:'s',ownerToken:'o',revision:4},fields={rowIds:[7],action:{type:'row-edit'},patch:{size:{mode:'blank'}}};
test('unknown write keeps original identity; explicit retry probes before sending the same body',async()=>{
 let online=false,ids=0;const writes=[],calls=[];
 const c=Commands.create({newId:()=>`m${++ids}`,request:async(a,p)=>{calls.push(a);if(a==='mutationStatus'){if(!online)throw Error('offline');return {state:'not-committed'};}writes.push(JSON.stringify(p.command));if(!online)throw Error('offline');return {revision:5,changed:1};}});
 await assert.rejects(c.run('review',session,fields),{code:'OUTCOME_UNKNOWN'});assert.equal(c.uncertain(),true);
 await assert.rejects(c.run('review',session,{...fields,rowIds:[8]}),{code:'OUTCOME_UNKNOWN'});assert.equal(writes.length,1);
 online=true;assert.equal((await c.run('review',session,fields)).revision,5);assert.equal(ids,1);assert.equal(writes[0],writes[1]);assert.deepEqual(calls,['review','mutationStatus','mutationStatus','review']);
});
test('double submit shares the in-flight command and stale completion cannot revive its context',async()=>{
 let resolve,writes=0;const c=Commands.create({newId:()=> 'once',request:async()=>{writes++;return new Promise(r=>resolve=r);}});
 const a=c.run('review',session,fields),b=c.run('review',session,fields);assert.equal(writes,1);c.reset();resolve({revision:5});
 await assert.rejects(a,{code:'STALE_CONTEXT'});await assert.rejects(b,{code:'STALE_CONTEXT'});assert.equal(c.inspect(),null);
});
test('committed receipt wins over a canceled worker notification after commit',async()=>{
 let writes=0;const c=Commands.create({newId:()=> 'committed',request:async(a)=>a==='mutationStatus'?{state:'committed',result:{revision:5,changed:1200}}:(writes++,{jobId:'j'}),waitForJob:async()=>{throw Object.assign(Error('canceled'),{code:'CANCELED'});}});
 assert.equal((await c.run('review',session,fields)).changed,1200);assert.equal(writes,1);
});
