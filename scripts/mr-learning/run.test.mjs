import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runDaily, meaningfulSnapshot } from './run.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daily-run-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const report=path.join(root,'skill-report.json');
  await fs.writeFile(report,JSON.stringify({actions:[]}));
  const config={output:root,collector:{config:'collector-config',output:'collection'},skills:{config:'skill-config',state:'state',report,applyValidated:true},historyHandoff:path.join(root,'history-handoff.json')};
  const configPath=path.join(root,'system.json');await fs.writeFile(configPath,JSON.stringify(config));
  return {root,configPath};
}
test('source failure still runs skill inventory and writes durable attention summary',async t=>{
  const {root,configPath}=await fixture(t);const calls=[];
  const summary=await runDaily(configPath,{execute:async(script,args)=>{
    calls.push({script,args});if(args.includes('--report')) await fs.writeFile(args[args.indexOf('--report')+1],JSON.stringify({actions:[]}));return calls.length===1 ? {ok:false,code:1,error:'source unavailable'}:{ok:true,code:0,result:{}};
  }});
  assert.equal(calls.length,2);assert.ok(calls[1].args.includes('--apply'));
  assert.equal(summary.status,'attention');assert.equal(summary.notify,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'latest-summary.json'),'utf8')).collection.ok,false);
});
test('unchanged successful rerun is quiet; new acceptance and handoff wake the summary',async t=>{
  const {root,configPath}=await fixture(t);let accepted=[];
  const execute=async(script,args)=>{ if(args.includes('--report')) await fs.writeFile(args[args.indexOf('--report')+1],JSON.stringify({actions:[]}));return {ok:true,code:0,result:script.endsWith('collector.mjs') ? {counts:{accepted:accepted.length},newAccepted:accepted}:{}};};
  assert.equal((await runDaily(configPath,{execute})).notify,true);
  assert.equal((await runDaily(configPath,{execute})).notify,false);
  accepted=['finding-1'];assert.equal((await runDaily(configPath,{execute})).notify,true);
  await fs.writeFile(path.join(root,'history-handoff.json'),JSON.stringify({readiness:'evaluated'}));
  assert.equal((await runDaily(configPath,{execute})).notify,true);
});

test('stable notifications ignore success timestamps and preserve material content outcomes',()=>{
 const collection={ok:true,result:{counts:{acceptedFindings:1}}};const handoff={status:'pending'};
 const report={actions:[{id:'mapped',operation:'current',previous:{successfulAt:'yesterday'},local:{status:'ok',hash:'same'},canonical:{status:'ok',hash:'same'}}],inventory:{roots:[{id:'codex',status:'ok',skills:[{name:'mapped',status:'ok',hash:'same'}]}]},outcomes:[{id:'mapped',status:'checkpointed',backups:['old']}],proposals:[]};
 const prior=meaningfulSnapshot(collection,report,handoff);
 report.actions[0].previous.successfulAt='today';report.outcomes[0].backups=['new'];report.createdAt='now';
 assert.deepEqual(meaningfulSnapshot(collection,report,handoff),prior);
 report.actions[0].local.hash='edited';assert.notDeepEqual(meaningfulSnapshot(collection,report,handoff),prior);
});

test('daily skill reports are immutable snapshots even when the latest report changes',async t=>{
 const {configPath}=await fixture(t);let content='before';
 const execute=async(script,args)=>{if(args.includes('--report')) await fs.writeFile(args[args.indexOf('--report')+1],JSON.stringify({actions:[],proposals:[{content}]}));return {ok:true,code:0,result:{counts:{accepted:0}}};};
 const first=await runDaily(configPath,{execute});const original=await fs.readFile(first.skillReportPath,'utf8');
 content='after';const second=await runDaily(configPath,{execute});
 assert.notEqual(first.skillReportPath,second.skillReportPath);assert.equal(await fs.readFile(first.skillReportPath,'utf8'),original);
 assert.ok((await fs.readFile(second.skillReportPath,'utf8')).includes('after'));
});


test('missing fresh report preserves latest report and persists explicit failure reason',async t=>{
 const {root,configPath}=await fixture(t);const latest=path.join(root,'skill-report.json');
 const original=await fs.readFile(latest,'utf8');
 const summary=await runDaily(configPath,{execute:async()=>({ok:true,code:0,result:{}})});
 assert.equal(summary.status,'attention');assert.equal(summary.skills.ok,true);
 assert.equal(summary.skillReportError,'Reconciliation report unavailable: ENOENT');
 assert.equal(await fs.readFile(latest,'utf8'),original);
 const saved=JSON.parse(await fs.readFile(path.join(root,'latest-summary.json'),'utf8'));
 assert.equal(saved.skillReportError,summary.skillReportError);
 assert.equal((await runDaily(configPath,{execute:async()=>({ok:true,code:0,result:{}})})).notify,false);
});

test('daily runner refuses an active lock and cleans its own lock after failure',async t=>{
 const {root,configPath}=await fixture(t);const lock=path.join(root,'.daily.lock');
 await fs.writeFile(lock,'active');
 await assert.rejects(runDaily(configPath),/Daily runner lock exists/);
 assert.equal(await fs.readFile(lock,'utf8'),'active');
 await fs.rm(lock);
 await assert.rejects(runDaily(configPath,{execute:async()=>{throw new Error('interrupted');}}),/interrupted/);
 await assert.rejects(fs.stat(lock),{code:'ENOENT'});
});

test('daily meaningful list uses retained canonical groups and ignores unknown or stale cached flags',()=>{
 const make=(id,type,cohort)=>({findingId:id,canonicalFindingId:id,mrKey:'1:1',area:'backend',learningEligible:true,
  evidenceVerified:true,learningCohort:cohort,reviewer:{id,type},evidence:{retention:{outcome:'retained',revision:'a'}}});
 const human=make('z','human','human'),bot=make('a','ai','secondary_ai'),unknown=make('unknown','unknown',null);
 const duplicate={...bot,findingId:'dupe',canonicalFindingId:'z',disposition:'duplicate',learningEligible:false};
 const stale={...make('stale','human','human'),evidence:{}};
 const snapshot=structuredClone(meaningfulSnapshot({ok:true},{},{},{findings:[bot,unknown,human,duplicate,stale]}));
 assert.deepEqual(snapshot.collection.accepted.map(g=>g.findingId),['z','a']);
 assert.equal(snapshot.collection.accepted[0].memberFindingIds.length,2);
 human.evidence.retention.revision='b';
 assert.notDeepEqual(meaningfulSnapshot({ok:true},{},{},{findings:[bot,unknown,human,duplicate,stale]}),snapshot);
});
