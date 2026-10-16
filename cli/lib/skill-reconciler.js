import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { guidanceSubsetHash, validateGuidanceManifest, isProhibitedGuidanceContent, validatePromotionEvidence } from '../../scripts/skill-eval/lib.js';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const existsError = (error) => error.code === 'ENOENT';
const safeName = (name) => typeof name === 'string' && name !== '.' && name !== '..' && !name.startsWith('.') && !/[\\/\0]/.test(name);
const failure = (target, error) => ({ path: target, status: 'failed', error: error.message });
const relativePath = (name) => name.split(path.sep).join('/');

/** Digest: sorted relative file paths, NUL, SHA256(bytes), newline. No mtimes. */
export async function hashSkillTree(target) {
  const files = [];
  async function walk(directory, prefix = '') {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Not an owned directory: ${directory}`);
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symlink excluded: ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        files.push({ path: relative, hash: sha(bytes), bytes: bytes.length });
      } else throw new Error(`Unsupported file: ${relative}`);
    }
  }
  try {
    await walk(target);
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const skillFile = files.find((entry) => entry.path === 'SKILL.md' || entry.path === 'SKILL.MD')?.path;
    if (!skillFile) throw new Error('SKILL.md or SKILL.MD missing');
    return { path: target, status: 'ok', hash: sha(files.map((entry) => `${entry.path}\0${entry.hash}\n`).join('')), files, skillFile };
  } catch (error) { return failure(target, error); }
}

export function defaultLocalRoots(env = process.env, home = os.homedir()) {
  return { codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'), agents: path.join(home, '.agents', 'skills') };
}

/** Only first-level personal directories. System/plugin dirs and links never become removals. */
export async function scanPersonalSkills(localRoots = defaultLocalRoots()) {
  const roots = [];
  for (const [id, root] of Object.entries(localRoots)) {
    const result = { id, path: root, status: 'ok', skills: [], excluded: [] };
    try {
      const info = await fs.lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Skill root unavailable or symlinked');
      const entries = (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || /^(?:plugins?|bundled)$/i.test(entry.name) || entry.isSymbolicLink()) {
          result.excluded.push({ name: entry.name, reason: entry.isSymbolicLink() ? 'symlink' : 'system-or-bundled' });
          continue;
        }
        if (!entry.isDirectory()) continue;
        const skill = await hashSkillTree(path.join(root, entry.name));
        // A first-level directory with an unreadable or missing marker stays visible as uncertain.
        result.skills.push({ rootId: id, name: entry.name, ...skill });
      }
    } catch (error) { result.status = 'failed'; result.error = error.message; }
    roots.push(result);
  }
  return { roots };
}

async function assertContained(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === '..' || part === '.')) throw new Error(`Unsafe relative path: ${relative}`);
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Unsafe root: ${root}`);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Path escapes root');
  let cursor = root;
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part);
    try {
      const info = await fs.lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`Symlink path excluded: ${cursor}`);
    } catch (error) { if (!existsError(error)) throw error; }
  }
  return absolute;
}

export async function scanCanonicalSkills(canonicalRoot) {
  const result = { root: canonicalRoot, status: 'ok', skills: [], commands: [] };
  try {
    const packages = await assertContained(canonicalRoot, 'packages');
    for (const pkg of (await fs.readdir(packages, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!pkg.isDirectory() || pkg.name.startsWith('.')) continue;
      for (const type of ['skills', 'commands', 'user-commands']) {
        const relative = `packages/${pkg.name}/${type}`;
        try {
          const directory = await assertContained(canonicalRoot, relative);
          for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const child = `${relative}/${entry.name}`;
            if (type === 'skills' && entry.isDirectory() && !entry.name.startsWith('.')) result.skills.push({ name: entry.name, canonical: child, ...await hashSkillTree(await assertContained(canonicalRoot, child)) });
            if (type !== 'skills' && entry.isFile() && /\.md$/i.test(entry.name)) result.commands.push({ name: entry.name.replace(/\.md$/i, ''), canonical: child, hash: sha(await fs.readFile(await assertContained(canonicalRoot, child))) });
          }
        } catch (error) { if (!existsError(error)) throw error; }
      }
    }
  } catch (error) { result.status = 'failed'; result.error = error.message; }
  return result;
}

export function validateReconcileConfig(config) {
  if (!config || config.version !== 1 || !path.isAbsolute(config.canonicalRoot || '')) throw new Error('Config version 1 and absolute canonicalRoot required');
  const roots = config.localRoots || defaultLocalRoots();
  if (!Object.keys(roots).length || Object.values(roots).some((root) => !path.isAbsolute(root))) throw new Error('Absolute local roots required');
  if (config.publicMirrorRoot && !path.isAbsolute(config.publicMirrorRoot)) throw new Error('publicMirrorRoot must be absolute');
  const distinct = [config.canonicalRoot, config.publicMirrorRoot, ...Object.values(roots)].filter(Boolean).map((value) => path.resolve(value));
  if (distinct.some((a, i) => distinct.some((b, j) => i !== j && (a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`))))) throw new Error('Canonical, mirror and personal roots must be separate');
  const mappings = config.mappings || [];
  const ids = new Set(); const locals = new Set(); const destinations = new Set();
  for (const mapping of mappings) {
    if (!/^[a-zA-Z0-9_-]+$/.test(mapping.id || '') || ids.has(mapping.id)) throw new Error('Unique safe mapping id required');
    if (!roots[mapping.localRoot] || !safeName(mapping.localName)) throw new Error(`Unsafe local mapping ${mapping.id}`);
    if (!/^packages\/[^./\\]+\/skills\/[^/\\]+$/.test(mapping.canonical || '') || mapping.canonical.split('/').some((part) => part === '.' || part === '..' || part.includes('\0'))) throw new Error(`Unsafe canonical mapping ${mapping.id}`);
    if (!['private', 'shared'].includes(mapping.classification)) throw new Error(`Explicit private/shared classification required: ${mapping.id}`);
    if (mapping.evalBaselineHash !== undefined && !/^[a-f0-9]{64}$/.test(mapping.evalBaselineHash)) throw new Error(`Immutable SHA256 evalBaselineHash required: ${mapping.id}`);
    if (mapping.evalBaselinePath !== undefined && !path.isAbsolute(mapping.evalBaselinePath)) throw new Error(`Absolute evalBaselinePath required: ${mapping.id}`);
    const local = `${mapping.localRoot}/${mapping.localName}`;
    if (locals.has(local) || destinations.has(mapping.canonical)) throw new Error('A path may have only one mapping; handle cross-root duplicates explicitly');
    if (mapping.classification === 'shared' && (config.privatePathPrefixes || []).some((prefix) => mapping.canonical.startsWith(prefix))) throw new Error(`Private path cannot be shared: ${mapping.id}`);
    ids.add(mapping.id); locals.add(local); destinations.add(mapping.canonical);
  }
  for (const pattern of config.forbiddenPublicPatterns || []) new RegExp(pattern, 'i');
  return { ...config, localRoots: roots, mappings };
}

async function inspectMapping(root, relative, rootStatus = 'ok') {
  if (rootStatus !== 'ok') return { status: 'failed', error: 'Root scan failed', path: path.join(root, relative) };
  try {
    const absolute = await assertContained(root, relative);
    try { await fs.lstat(absolute); } catch (error) { if (existsError(error)) return { status: 'absent', path: absolute, hash: null }; throw error; }
    return await hashSkillTree(absolute);
  } catch (error) { return failure(path.join(root, relative), error); }
}

const identity = (config, mapping) => sha(JSON.stringify([config.canonicalRoot, config.localRoots[mapping.localRoot], mapping.localName, mapping.canonical, mapping.classification, config.publicMirrorRoot || null]));

/** Preview is read-only. Unmapped candidates always require an explicit mapping/classification. */
export async function planSkillReconciliation(rawConfig, state = {}) {
  const config = validateReconcileConfig(rawConfig);
  const inventory = await scanPersonalSkills(config.localRoots);
  const canonicalInventory = await scanCanonicalSkills(config.canonicalRoot);
  const actions = [];
  for (const mapping of config.mappings) {
    const root = inventory.roots.find((item) => item.id === mapping.localRoot);
    const excluded = root.excluded.find((entry) => entry.name === mapping.localName);
    const local = excluded ? { path: path.join(root.path, mapping.localName), status: 'failed', error: `Excluded personal source: ${excluded.reason}` } : root.skills.find((item) => item.name === mapping.localName) || await inspectMapping(root.path, mapping.localName, root.status);
    const canonical = await inspectMapping(config.canonicalRoot, mapping.canonical, canonicalInventory.status);
    const mirror = mapping.classification === 'shared' && config.publicMirrorRoot ? await inspectMapping(config.publicMirrorRoot, mapping.canonical) : null;
    const key = identity(config, mapping);
    const previous = state.entries?.[mapping.id]?.identity === key ? state.entries[mapping.id] : null;
    const item = { id: mapping.id, mapping, identity: key, local, canonical, mirror, previous, operation: 'blocked', reason: null };
    if (local.status === 'failed' || canonical.status === 'failed' || mirror?.status === 'failed') item.reason = 'Source unavailable, unreadable, or symlinked; never infer deletion';
    else if (local.hash === canonical.hash) {
      item.operation = local.hash ? (previous && previous.localHash !== local.hash ? 'verify-edit' : 'current') : (previous && (previous.localHash || previous.canonicalHash) ? 'removal-proposal' : 'absent');
      if (item.operation === 'removal-proposal') item.reason = 'Both copies removed; evaluated removal decision required, baseline preserved';
    } else if (!previous) {
      item.operation = !canonical.hash ? 'export-add' : !local.hash ? 'import-add' : 'conflict';
      if (item.operation === 'conflict') item.reason = 'Divergent first observation; choose a version explicitly';
    } else {
      const localChanged = local.hash !== previous.localHash;
      const canonicalChanged = canonical.hash !== previous.canonicalHash;
      if (localChanged && canonicalChanged) { item.operation = 'conflict'; item.reason = 'Both sides changed since successful reconciliation'; }
      else if (!local.hash || !canonical.hash) { item.operation = 'removal-proposal'; item.reason = 'Deletion requires a reviewed removal decision; automatic deletion disabled'; }
      else if (localChanged) item.operation = 'export-edit';
      else if (canonicalChanged) item.operation = 'import-edit';
      else { item.operation = 'conflict'; item.reason = 'Baseline contains unresolved divergence'; }
    }
    if (mirror && !['blocked', 'conflict', 'removal-proposal', 'absent'].includes(item.operation)) {
      const expected = item.operation.startsWith('export') ? canonical.hash : local.hash;
      const safeMirror = mirror.status === 'absent' || mirror.hash === expected || mirror.hash === canonical.hash || (previous && mirror.hash === previous.mirrorHash);
      if (!safeMirror) { item.operation = 'conflict'; item.reason = 'Public mirror changed independently; preserve all versions'; }
      else if (item.operation === 'current' && mirror.hash !== canonical.hash) item.operation = 'mirror-update';
    }
    const candidate = item.operation.startsWith('export') ? local : canonical;
    item.candidateHash = candidate.hash || null;
    item.evalArtifact = mapping.evalArtifact || null;
    if (item.operation.endsWith('-add')) {
      item.baselineHash = mapping.evalBaselineHash || null;
      item.baselineSource = mapping.evalBaselinePath || null;
      item.baselineKind = 'explicit-review-workflow';
    } else {
      item.baselineHash = previous?.localHash || previous?.canonicalHash || (item.operation === 'mirror-update' ? local.hash : null);
      item.baselineKind = previous?.localHash ? 'last-successful-checkpoint' : 'current-mapping';
      item.baselineSource = previous?.baselinePath || null;
      if (!item.baselineSource && item.baselineHash) item.baselineSource = [local, canonical, mirror].find((skill) => skill?.status === 'ok' && skill.hash === item.baselineHash)?.path || null;
    }
    actions.push(item);
  }
  const mapped = new Set(config.mappings.map((item) => `${item.localRoot}/${item.localName}`));
  const proposals = [];
  for (const root of inventory.roots) for (const local of root.skills) {
    if (mapped.has(`${root.id}/${local.name}`)) continue;
    const matching = canonicalInventory.skills.filter((item) => item.name === local.name && item.status === 'ok');
    let commandName = null;
    if (local.status === 'ok') {
      const content = await fs.readFile(path.join(local.path, local.skillFile), 'utf8');
      const converted = content.match(/<!-- Converted from ([^\n]+?)\.md\./);
      const migrated = content.match(/migrated source command `([^`]+)`/);
      commandName = converted ? path.basename(converted[1]) : migrated?.[1];
    }
    const commands = commandName ? canonicalInventory.commands.filter((item) => item.name === commandName) : [];
    proposals.push({ localRoot: root.id, localName: local.name, hash: local.hash || null, status: local.status, kind: matching.length === 1 ? 'same-name-candidate' : commands.length === 1 ? 'converted-command-candidate' : 'unmapped', candidates: matching.length ? matching.map((item) => item.canonical) : commands.map((item) => item.canonical), requires: ['explicit-mapping', 'classification', 'behavioral-eval'], reason: commands.length ? 'Command wrapper requires an explicit transformation; tree overwrite is unsupported' : 'Never delete or import an unmapped personal skill automatically' });
  }
  const inventoryChanges = [];
  for (const root of inventory.roots) {
    const observed = state.observations?.[root.id];
    const previous = observed?.path === root.path ? observed : null;
    const now = new Map(root.skills.map((item) => [item.name, item]));
    if (root.status !== 'ok') { inventoryChanges.push({ rootId: root.id, kind: 'scan-failed', reason: root.error }); continue; }
    for (const item of root.skills) {
      if (item.status !== 'ok') { inventoryChanges.push({ rootId: root.id, name: item.name, kind: 'uncertain', reason: item.error }); continue; }
      const old = previous?.skills?.[item.name];
      if (!old) inventoryChanges.push({ rootId: root.id, name: item.name, kind: previous ? 'added' : 'discovered', hash: item.hash });
      else if (old.hash !== item.hash) inventoryChanges.push({ rootId: root.id, name: item.name, kind: 'edited', beforeHash: old.hash, hash: item.hash });
    }
    if (previous) for (const [name, old] of Object.entries(previous.skills || {})) {
      if (!now.has(name) && !root.excluded.some((item) => item.name === name)) inventoryChanges.push({ rootId: root.id, name, kind: 'removal-proposal', beforeHash: old.hash });
    }
  }
  return { version: 1, createdAt: new Date().toISOString(), configHash: sha(JSON.stringify(config)), stateHash: sha(JSON.stringify(state)), inventory, canonicalInventory, inventoryChanges, actions, proposals };
}

export async function readReconcileState(statePath) {
  try { return JSON.parse(await fs.readFile(statePath, 'utf8')); }
  catch (error) { if (existsError(error)) return { version: 1, entries: {}, observations: {} }; throw new Error(`State load failed; refusing reset: ${error.message}`); }
}

async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('State/report symlink excluded'); } catch (error) { if (!existsError(error)) throw error; }
  const staging = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.rename(staging, target);
}

/** Same prompt-file policy and subset digest as the evaluator; no second allowlist. */
export function validateSkillEvalGuidance(guidance, actualTrees = {}) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const validHash = (hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  try {
    require(guidance?.version === 1 && guidance.verified === true, 'Verified guidance metadata required; regenerate older eval reports');
    require(['explicit', 'implicit-all-safe'].includes(guidance.mode), 'Invalid guidance mode');
    const manifest = validateGuidanceManifest(guidance.manifest, { requireSorted: true });
    require(validHash(guidance.manifestHash) && sha(JSON.stringify(manifest)) === guidance.manifestHash, 'Guidance manifest hash mismatch');
    if (guidance.mode === 'explicit') require(validHash(guidance.manifestSourceHash) && typeof guidance.manifestPath === 'string' && path.isAbsolute(guidance.manifestPath), 'Explicit guidance source metadata required');
    else require(guidance.manifestSourceHash === null && guidance.manifestPath === null, 'Implicit guidance must not claim an explicit source');
    for (const arm of ['baseline', 'candidate']) {
      const selected = manifest[`${arm}Files`];
      const records = guidance[arm]?.files;
      require(Array.isArray(records) && records.length === selected.length, `${arm} guidance records do not match manifest`);
      require(records.every((record, index) => record && Object.keys(record).sort().join(',') === 'hash,path' && record.path === selected[index] && validHash(record.hash)), `${arm} guidance file records invalid`);
      require(validHash(guidance[arm].hash) && guidanceSubsetHash(records) === guidance[arm].hash, `${arm} guidance subset hash mismatch`);
      const actual = actualTrees[`${arm}Files`];
      if (actual) {
        require(Array.isArray(actual), `${arm} actual tree records unavailable`);
        const hashes = new Map(actual.map((record) => [record.path, record.hash]));
        require(records.every((record) => hashes.get(record.path) === record.hash), `${arm} guidance does not match bound skill contents`);
        if (guidance.mode === 'implicit-all-safe') require(actual.length === records.length, `${arm} implicit guidance omitted bound skill files`);
      }
    }
    return { eligible: true, reason: null };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

export async function validateSkillEval(artifactPath, candidateHash, baselineHash, actualTrees = {}) {
  if (!artifactPath) return { eligible: false, reason: 'Hash-bound behavioral eval required' };
  if (!/^[a-f0-9]{64}$/.test(baselineHash || '')) return { eligible: false, reason: 'Existing evaluated review baseline hash required; first additions need explicit evalBaselineHash' };
  try {
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    const guidance = validateSkillEvalGuidance(artifact.guidance, actualTrees);
    if (!guidance.eligible) return { eligible: false, reason: `Guidance gate failed: ${guidance.reason}` };
    for (const arm of ['baseline', 'candidate']) {
      const root = actualTrees[`${arm}Path`];
      if (!root) continue;
      for (const file of artifact.guidance[arm].files) {
        const target = await assertContained(root, file.path);
        const bytes = await fs.readFile(target);
        if (sha(bytes) !== file.hash) return { eligible: false, reason: `Guidance gate failed: ${arm}/${file.path} changed since the bound file inventory` };
        if (isProhibitedGuidanceContent(bytes.toString('utf8'))) return { eligible: false, reason: `Guidance gate failed: serialized oracle/outcome content prohibited in ${arm}/${file.path}` };
      }
    }
    if (artifact.guidance.mode === 'implicit-all-safe' && (artifact.guidance.baseline.hash !== artifact.baselineHash || artifact.guidance.candidate.hash !== artifact.candidateHash)) return { eligible: false, reason: 'Implicit guidance hashes must match both full bound skill tree hashes' };
    const requiredKinds = ['offending', 'corrected', 'clean', 'rejected', 'boundary'];
    const hasCases = ['development', 'heldout'].every((split) => requiredKinds.every((kind) => artifact.coverage?.[split]?.[kind] > 0 && artifact.cases?.some((item) => item.split === split && item.kind === kind && item.baseline && item.candidate)));
    const executionsSucceeded = artifact.cases?.length > 0 && artifact.cases.every((item) => ['baseline', 'candidate'].every((variant) => item[variant]?.execution?.succeeded === true && item[variant].execution.observedModel?.name && item[variant].execution.observedModel?.runtime));
    const eligible = artifact.version === 1 && artifact.candidateHash === candidateHash && artifact.baselineHash === baselineHash && artifact.status === 'complete' && artifact.behavioralExecuted === true && artifact.evidenceKind === 'real' && artifact.runtime?.adapterMode === 'model' && artifact.suiteHash && artifact.adapterHash && artifact.promotion?.eligible === true && hasCases && executionsSucceeded && artifact.coverage?.chronologicallyDisjoint === true && artifact.coverage?.mrDisjoint === true;
    if (!eligible) return { eligible: false, reason: 'Eval failed, synthetic, incomplete, stale, or not eligible for promotion' };
    const promotion = validatePromotionEvidence(artifact);
    return { eligible: promotion.eligible, artifactHash: sha(JSON.stringify(artifact)), reason: promotion.eligible ? null : `Behavioral evidence gate failed: ${promotion.reasons.join('; ')}` };
  } catch (error) { return { eligible: false, reason: `Eval unavailable: ${error.message}` }; }
}

async function checkPublicCandidate(config, skill) {
  if (!config.publicMirrorRoot) throw new Error('Shared change requires publicMirrorRoot');
  if (!Array.isArray(config.forbiddenPublicPatterns) || !config.forbiddenPublicPatterns.length) throw new Error('Shared writes require explicit forbiddenPublicPatterns for private details');
  const patterns = [...config.forbiddenPublicPatterns, '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', '(?:password|api[_-]?key|access[_-]?token)\\s*[:=]\\s*["\\\x27]?[A-Za-z0-9_+/=-]{20,}'].map((pattern) => new RegExp(pattern, 'i'));
  for (const file of skill.files) {
    const content = await fs.readFile(path.join(skill.path, file.path), 'utf8');
    if (patterns.some((pattern) => pattern.test(file.path) || pattern.test(content))) throw new Error(`Public boundary check failed: ${file.path}`);
  }
}

async function preserveBaselineTree(source, expectedHash, statePath) {
  if (!source || (await hashSkillTree(source)).hash !== expectedHash) throw new Error('Baseline contents unavailable or changed; eval reference must match immutable baseline hash');
  const saved = path.join(path.dirname(statePath), 'skill-reconcile-backups', 'baselines', expectedHash);
  await fs.mkdir(path.dirname(saved), { recursive: true });
  try { await fs.lstat(saved); }
  catch (error) {
    if (!existsError(error)) throw error;
    const staging = `${saved}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.cp(source, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
      if ((await hashSkillTree(staging)).hash !== expectedHash) throw new Error('Baseline changed during preservation');
      await fs.rename(staging, saved);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  if ((await hashSkillTree(saved)).hash !== expectedHash) throw new Error('Retained baseline hash mismatch; preserved reference requires investigation');
  return saved;
}

async function copyVerified(source, destination, expectedSourceHash, expectedDestinationHash, backupRoot, label) {
  const beforeSource = await hashSkillTree(source);
  const snapshotDestination = async () => {
    try { await fs.lstat(destination); } catch (error) { if (existsError(error)) return { status: 'absent', hash: null }; throw error; }
    return hashSkillTree(destination);
  };
  const beforeDestination = await snapshotDestination();
  if (beforeSource.hash !== expectedSourceHash || beforeDestination.status === 'failed' || beforeDestination.hash !== expectedDestinationHash) throw new Error('Stale plan: content changed before write');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staging = path.join(path.dirname(destination), `.skill-reconcile-${crypto.randomUUID()}`);
  try {
    await fs.cp(source, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
    if ((await hashSkillTree(staging)).hash !== expectedSourceHash || (await hashSkillTree(source)).hash !== expectedSourceHash) throw new Error('Source changed during staging');
    const latest = await snapshotDestination();
    if (latest.status === 'failed' || latest.hash !== expectedDestinationHash) throw new Error('Destination changed during staging');
    let backup = null;
    if (expectedDestinationHash) {
      backup = path.join(backupRoot, label);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.rename(destination, backup);
      if ((await hashSkillTree(backup)).hash !== expectedDestinationHash) {
        const current = await snapshotDestination();
        if (current.status === 'absent') await fs.rename(backup, destination);
        throw new Error('Destination changed during backup move; candidate blocked and newer contents preserved');
      }
    }
    try { await fs.rename(staging, destination); }
    catch (error) { if (backup) await fs.rename(backup, destination); throw error; }
    return backup;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Explicit apply, never automatic deletion. Successful items get per-mapping checkpoints. */
export async function applySkillReconciliation(rawConfig, plan, { statePath } = {}) {
  if (!statePath || !path.isAbsolute(statePath)) throw new Error('Absolute statePath required');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) { throw new Error(`Reconciliation lock unavailable; another run or interrupted run requires attention: ${error.message}`); }
  try { return await applyLocked(rawConfig, plan, statePath); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}

async function applyLocked(rawConfig, plan, statePath) {
  const config = validateReconcileConfig(rawConfig);
  const state = await readReconcileState(statePath);
  if (sha(JSON.stringify(config)) !== plan.configHash || sha(JSON.stringify(state)) !== plan.stateHash) throw new Error('Stale plan: config or checkpoint changed');
  const fresh = await planSkillReconciliation(config, state);
  const fingerprint = (item) => JSON.stringify([item.identity, item.operation, item.local.status, item.local.hash, item.canonical.status, item.canonical.hash, item.mirror?.status, item.mirror?.hash, item.baselineHash, item.baselineSource]);
  if (fresh.actions.length !== plan.actions.length || fresh.actions.some((item, index) => fingerprint(item) !== fingerprint(plan.actions[index]))) throw new Error('Stale plan: skill content changed');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const backupRoot = path.join(path.dirname(statePath), 'skill-reconcile-backups', runId);
  const outcomes = [];
  state.entries ||= {}; state.observations ||= {};
  for (const item of fresh.actions) {
    const outcome = { id: item.id, operation: item.operation, status: 'blocked', reason: item.reason, backups: [] };
    const writes = [];
    const write = async (source, destination, sourceHash, destinationHash, label) => {
      const backup = await copyVerified(source, destination, sourceHash, destinationHash, backupRoot, label);
      writes.push({ destination, backup, label, hash: sourceHash });
      outcome.backups.push(backup);
    };
    try {
      if (item.operation === 'conflict') {
        for (const [side, skill] of [['local', item.local], ['canonical', item.canonical], ['mirror', item.mirror]]) {
          if (skill?.status !== 'ok') continue;
          const backup = path.join(path.dirname(statePath), 'skill-reconcile-backups', 'conflicts', `${item.id}-${item.identity.slice(0, 12)}`, `${side}-${skill.hash}`);
          await fs.mkdir(path.dirname(backup), { recursive: true });
          try { await fs.lstat(backup); }
          catch (error) { if (!existsError(error)) throw error; await fs.cp(skill.path, backup, { recursive: true, dereference: false, errorOnExist: true, force: false }); }
          if ((await hashSkillTree(backup)).hash !== skill.hash) throw new Error('Conflict source changed during backup');
          outcome.backups.push(backup);
        }
        outcome.status = 'conflict-preserved';
      } else if (['blocked', 'removal-proposal'].includes(item.operation)) {
        // Keep the last successful baseline intact.
      } else {
        if (!['current', 'absent'].includes(item.operation)) {
          const candidate = item.operation.startsWith('export') ? item.local : item.canonical;
          const baseline = item.baselineSource ? await hashSkillTree(item.baselineSource) : null;
          const gate = await validateSkillEval(item.evalArtifact, item.candidateHash, item.baselineHash, { candidateFiles: candidate.files, candidatePath: candidate.path, baselineFiles: baseline?.hash === item.baselineHash ? baseline.files : undefined, baselinePath: baseline?.hash === item.baselineHash ? baseline.path : undefined });
          if (!gate.eligible) throw new Error(gate.reason);
          outcome.evalBaselineHash = item.baselineHash;
          outcome.evalBaselinePath = await preserveBaselineTree(item.baselineSource, item.baselineHash, statePath);
          if (item.mapping.classification === 'shared') await checkPublicCandidate(config, candidate);
          // Validate all parent paths again immediately before writes.
          const local = await assertContained(config.localRoots[item.mapping.localRoot], item.mapping.localName);
          const canonical = await assertContained(config.canonicalRoot, item.mapping.canonical);
          if (item.operation.startsWith('export')) await write(local, canonical, item.candidateHash, item.canonical.hash, `${item.id}/canonical`);
          if (item.operation.startsWith('import')) await write(canonical, local, item.candidateHash, item.local.hash, `${item.id}/local`);
          if (item.mapping.classification === 'shared' && item.mirror?.hash !== item.candidateHash) {
            const mirror = await assertContained(config.publicMirrorRoot, item.mapping.canonical);
            const source = item.operation.startsWith('export') ? local : canonical;
            await write(source, mirror, item.candidateHash, item.mirror?.hash || null, `${item.id}/mirror`);
          }
          outcome.evalArtifactHash = gate.artifactHash;
        }
        const local = await inspectMapping(config.localRoots[item.mapping.localRoot], item.mapping.localName);
        const canonical = await inspectMapping(config.canonicalRoot, item.mapping.canonical);
        const mirror = item.mirror ? await inspectMapping(config.publicMirrorRoot, item.mapping.canonical) : null;
        if (local.status === 'failed' || canonical.status === 'failed' || local.hash !== canonical.hash || (mirror && mirror.hash !== canonical.hash)) throw new Error('Post-write verification failed; checkpoint not advanced');
        const baselinePath = local.hash ? await preserveBaselineTree(local.path, local.hash, statePath) : null;
        state.entries[item.id] = { identity: item.identity, localHash: local.hash, canonicalHash: canonical.hash, mirrorHash: mirror?.hash || null, baselinePath, successfulAt: new Date().toISOString() };
        outcome.status = ['current', 'absent'].includes(item.operation) ? 'checkpointed' : 'applied';
        outcome.reason = null;
      }
    } catch (error) {
      outcome.reason = error.message;
      // Preserve failed installation copies and restore originals if no newer edit appeared.
      for (const change of writes.reverse()) {
        try {
          if ((await hashSkillTree(change.destination)).hash !== change.hash) throw new Error('Newer edit preserved; rollback requires attention');
          const saved = path.join(backupRoot, `${change.label}-rolled-back`);
          await fs.mkdir(path.dirname(saved), { recursive: true });
          await fs.rename(change.destination, saved);
          outcome.backups.push(saved);
          if (change.backup) await fs.rename(change.backup, change.destination);
        } catch (rollbackError) { outcome.reason += `; rollback: ${rollbackError.message}`; }
      }
    }
    outcome.backups = outcome.backups.filter(Boolean);
    outcomes.push(outcome);
  }
  // Root observation checkpoints detect unmapped changes; these are not reconciliation checkpoints.
  const postApplyInventory = await scanPersonalSkills(config.localRoots);
  for (const root of postApplyInventory.roots) {
    if (root.status !== 'ok') continue;
    const observation = state.observations[root.id];
    const old = observation?.path === root.path ? observation.skills || {} : {};
    const skills = Object.fromEntries(root.skills.filter((item) => item.status === 'ok').map((item) => [item.name, { hash: item.hash }]));
    for (const item of root.skills.filter((item) => item.status !== 'ok')) if (old[item.name]) skills[item.name] = old[item.name];
    for (const item of root.excluded) if (old[item.name]) skills[item.name] = old[item.name];
    // Keep unresolved removal tombstones so a later catch-up cannot silently drop the proposal.
    for (const [name, item] of Object.entries(old)) if (!skills[name] && !root.skills.some((skill) => skill.name === name)) skills[name] = { ...item, removalPending: true };
    state.observations[root.id] = { path: root.path, successfulScanAt: new Date().toISOString(), skills };
  }
  state.version = 1; state.lastRunAt = new Date().toISOString();
  await writeJsonAtomic(statePath, state);
  return { ...fresh, postApplyInventory, runId, outcomes, statePath, summary: { applied: outcomes.filter((item) => item.status === 'applied').length, checkpointed: outcomes.filter((item) => item.status === 'checkpointed').length, conflicts: outcomes.filter((item) => item.status === 'conflict-preserved').length, blocked: outcomes.filter((item) => item.status === 'blocked').length } };
}

export async function runSkillReconciliation({ configPath, statePath, reportPath, apply = false }) {
  if (!configPath || !statePath) throw new Error('--config and --state required');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  // Relative eval artifacts are resolved beside config, not against the invoking shell.
  for (const mapping of config.mappings || []) for (const key of ['evalArtifact', 'evalBaselinePath']) if (mapping[key] && !path.isAbsolute(mapping[key])) mapping[key] = path.resolve(path.dirname(configPath), mapping[key]);
  const state = await readReconcileState(statePath);
  const plan = await planSkillReconciliation(config, state);
  const report = apply ? await applySkillReconciliation(config, plan, { statePath }) : { ...plan, mode: 'preview' };
  if (reportPath) await writeJsonAtomic(reportPath, report);
  return report;
}
