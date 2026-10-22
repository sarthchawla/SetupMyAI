#!/usr/bin/env node
import path from 'node:path';
import { runSkillReconciliation } from '../cli/lib/skill-reconciler.js';

const args = process.argv.slice(2);
const options = { apply: false };
try {
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') {
      process.stdout.write('Usage: node scripts/skill-reconcile.mjs --config CONFIG.json --state STATE.json [--report REPORT.json] [--apply]\nDefault: content inventory and preview. --apply explicitly reconciles evaluated mapped skills and records safe checkpoints.\n');
      process.exit(0);
    }
    if (flag === '--apply') { options.apply = true; continue; }
    const key = { '--config': 'configPath', '--state': 'statePath', '--report': 'reportPath' }[flag];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${flag}`);
    options[key] = path.resolve(args[++index]);
  }
  const report = await runSkillReconciliation(options);
  const operations = report.actions.reduce((counts, item) => ({ ...counts, [item.operation]: (counts[item.operation] || 0) + 1 }), {});
  process.stdout.write(`${JSON.stringify({ mode: options.apply ? 'apply' : 'preview', roots: report.inventory.roots.map((root) => ({ id: root.id, status: root.status, skills: root.skills.length })), operations, unmappedProposals: report.proposals.length, observedChanges: report.inventoryChanges.length, summary: report.summary || null, reportPath: options.reportPath || null }, null, 2)}\n`);
  if (report.inventory.roots.some((root) => root.status !== 'ok') || report.canonicalInventory.status !== 'ok' || (options.apply && (report.summary.blocked || report.summary.conflicts))) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`Skill reconciliation failed: ${error.message}\n`);
  process.exitCode = 1;
}
