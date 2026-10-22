#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceGroups } from './collector.mjs';

export async function runCommand(script, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => resolve({ok:false, error:e.message}));
    child.on('close', code => {
      let result; try { result = JSON.parse(stdout); } catch { result = {output:stdout.slice(-4000)}; }
      resolve({ok:code === 0, code, result, error:stderr.slice(-4000) || undefined});
    });
  });
}
async function readJSON(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export function meaningfulSnapshot(collection, skillReport, handoff, corpus = {}) {
  const actions = (skillReport.actions || []).map(a => ({id:a.id,operation:a.operation,reason:a.reason,
    local:{status:a.local?.status,hash:a.local?.hash},canonical:{status:a.canonical?.status,hash:a.canonical?.hash},
    mirror:a.mirror ? {status:a.mirror.status,hash:a.mirror.hash}:undefined}));
  const inventory=(skillReport.inventory?.roots || []).map(r=>({id:r.id,status:r.status,error:r.error,
    skills:r.skills.map(s=>({name:s.name,status:s.status,hash:s.hash,error:s.error}))}));
  const accepted=acceptanceGroups(corpus.findings || []).map(group=>({...group,
    evidence:group.memberFindingIds.map(id=>{
      const finding=corpus.findings.find(f=>f.findingId===id);
      return {id,pattern:finding.pattern,area:finding.area,fix:finding.evidence?.fix?.diffSha256,retention:finding.evidence?.retention};
    })}));
  return {collection:{ok:collection.ok,counts:collection.result?.counts,accepted,attributionWarnings:collection.result?.coverage?.reviewerAttributionErrors,
    errors:collection.ok ? corpus.error : collection.result?.errors ?? collection.error},
    skills:{actions,inventory,proposals:skillReport.proposals,
      outcomes:(skillReport.outcomes || []).map(o=>({id:o.id,status:o.status,reason:o.reason})),
      error:skillReport.error},handoff};
}
async function runDailyUnlocked(configPath, {execute=runCommand} = {}) {
  const config = await readJSON(configPath);
  const output = path.resolve(config.output);
  await fs.mkdir(output, {recursive:true,mode:0o700});
  const startedAt = new Date().toISOString();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const collectorArgs = ['--config',config.collector.config,'--output',config.collector.output];
  if(config.collector.adjudications) collectorArgs.push('--adjudications',config.collector.adjudications);
  const collection = await execute(path.join(here,'collector.mjs'),collectorArgs);
  // A failed source must not prevent independent skill drift detection.
  const reportDirectory=path.join(output,'skill-reports');await fs.mkdir(reportDirectory,{recursive:true,mode:0o700});
  const skillSnapshotPath=path.join(reportDirectory,`${startedAt.replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}.json`);
  const syncArgs = ['--config',config.skills.config,'--state',config.skills.state,'--report',skillSnapshotPath];
  if(config.skills.applyValidated) syncArgs.push('--apply');
  const skills = await execute(path.resolve(here,'../skill-reconcile.mjs'),syncArgs);
  let handoff;
  try {
    const historical = await readJSON(config.historyHandoff);
    handoff = {status:'available',path:config.historyHandoff, readiness:historical.readiness ?? historical.status ?? 'requires_inspection',contentHash:crypto.createHash('sha256').update(JSON.stringify(historical)).digest('hex'), message:'Inspect exact evaluated content and integration needs before promotion; historical artifacts are read-only to this runner.'};
  } catch(e) {
    handoff = {status:e.code === 'ENOENT' ? 'pending' : 'failed',path:config.historyHandoff,error:e.code === 'ENOENT' ? undefined : e.message};
  }
  let skillReport;
  try {
    skillReport = await readJSON(skillSnapshotPath);
    const latestReport=path.resolve(config.skills.report);await fs.mkdir(path.dirname(latestReport),{recursive:true});
    const temporaryReport=latestReport+`.${process.pid}.tmp`;
    await fs.writeFile(temporaryReport,JSON.stringify(skillReport,null,2)+'\n',{mode:0o600});await fs.rename(temporaryReport,latestReport);
  } catch(e) { skillReport={error:`Reconciliation report unavailable: ${e.code || e.message}`}; }
  const summary = {version:1,startedAt,finishedAt:new Date().toISOString(),status:collection.ok && skills.ok && handoff.status !== 'failed' ? 'success':'attention',collection,skills,historyHandoff:handoff,skillReportPath:skillSnapshotPath,latestSkillReportPath:config.skills.report,sourceEvidencePrivate:true};
  // Stable fields only: polling is quiet when no meaningful outcomes changed.
  if(skillReport.error) { summary.status='attention';summary.skillReportError=skillReport.error; }
  let corpus={};
  if(collection.result?.corpusPath) { try { corpus=await readJSON(collection.result.corpusPath); } catch(e) { summary.status='attention';corpus={error:e.message}; } }
  const meaningful = meaningfulSnapshot(collection,skillReport,handoff,corpus);
  summary.meaningfulHash = crypto.createHash('sha256').update(JSON.stringify(meaningful)).digest('hex');
  let previous; try { previous=await readJSON(path.join(output,'latest-summary.json')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  summary.notify = previous?.meaningfulHash !== summary.meaningfulHash;
  const runPath=path.join(output,`run-${startedAt.replace(/[:.]/g,'-')}.json`);
  await fs.writeFile(runPath,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  const latest=path.join(output,'latest-summary.json'), temp=latest+`.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify(summary,null,2)+'\n',{mode:0o600}); await fs.rename(temp,latest);
  return {...summary,summaryPath:runPath};
}
export async function runDaily(configPath, options = {}) {
  const config = await readJSON(configPath);
  await fs.mkdir(config.output, {recursive:true,mode:0o700});
  const lockPath=path.join(config.output,'.daily.lock');
  let lock;
  try { lock=await fs.open(lockPath,'wx',0o600); }
  catch(error) { if(error.code==='EEXIST') throw new Error('Daily runner lock exists; inspect the active run before deployment or retry'); throw error; }
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    return await runDailyUnlocked(configPath,options);
  } finally { await lock.close(); await fs.rm(lockPath); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const i=process.argv.indexOf('--config'); if(i < 0 || !process.argv[i+1]) throw new Error('Usage: node run.mjs --config <private-system.json>');
    const summary=await runDaily(path.resolve(process.argv[i+1]));
    console.log(JSON.stringify({status:summary.status,notify:summary.notify,summaryPath:summary.summaryPath,collection:{ok:summary.collection.ok,counts:summary.collection.result?.counts,discovery:summary.collection.result?.discovery,extraction:summary.collection.result?.extraction,checkpoint:summary.collection.result?.checkpoint,summaryPath:summary.collection.result?.summaryPath,errors:summary.collection.result?.errors ?? summary.collection.error,attributionWarnings:summary.collection.result?.coverage?.reviewerAttributionErrors},skills:summary.skills.result,skillReportError:summary.skillReportError,historyHandoff:summary.historyHandoff}));
    if(summary.status !== 'success') process.exitCode=1;
  } catch(e) { console.error(e.message);process.exitCode=1; }
}
