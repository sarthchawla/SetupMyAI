#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const DISPOSITIONS = new Set(['accepted_and_fixed', 'pushed_back', 'false_positive', 'withdrawn', 'duplicate', 'unresolved', 'uncertain']);
const AREAS = new Set(['frontend', 'backend', 'CI/build', 'other']);
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const iso = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid timestamp: ${value}`);
  return new Date(value).toISOString();
};
const mrKey = (mr) => `${mr.project_id}:${mr.iid}`;
const compareIds = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const asArray = (value, endpoint) => {
  if (!Array.isArray(value)) throw new Error(`Expected an array from ${endpoint}`);
  return value;
};

export function validateConfig(config) {
  if (!config || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(config.host || '')) throw new Error('config.host must be a hostname, optionally with a port');
  if (!Number.isSafeInteger(config.identity?.id) || config.identity.id <= 0 || !config.identity.username) throw new Error('config.identity requires a positive numeric id and username');
  const pageSize = config.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('pageSize must be between 1 and 100');
  const overlapSeconds = config.overlapSeconds ?? 300;
  if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0) throw new Error('overlapSeconds must be nonnegative');
  const maxPages = config.maxPages ?? 100000;
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages must be a positive integer');
  const cohorts = ['verifiedAiUserIds', 'verifiedHumanUserIds', 'verifiedServiceUserIds'];
  const seen = new Set();
  for (const field of cohorts) {
    if (config[field] !== undefined && !Array.isArray(config[field])) throw new Error(`${field} must be an array`);
    for (const id of config[field] || []) {
      if (!/^[1-9]\d*$/.test(String(id)) || seen.has(String(id))) throw new Error('Verified reviewer IDs must be positive and belong to exactly one cohort');
      seen.add(String(id));
    }
  }
  if (config.learningSecondaryAiUserIds !== undefined && !Array.isArray(config.learningSecondaryAiUserIds)) throw new Error('learningSecondaryAiUserIds must be an array');
  if ((config.learningSecondaryAiUserIds || []).some((id) => !(config.verifiedAiUserIds || []).map(String).includes(String(id)))) throw new Error('Secondary learning reviewers must be verified AI accounts');
  return { ...config, host: config.host.toLowerCase(), pageSize, overlapSeconds, maxPages,
    initialSince: config.initialSince ? iso(config.initialSince) : null,
    initialIncludeOpen: config.initialIncludeOpen !== false,
    verifiedAiUserIds: (config.verifiedAiUserIds ?? []).map(String),
    verifiedHumanUserIds: (config.verifiedHumanUserIds ?? []).map(String),
    verifiedServiceUserIds: (config.verifiedServiceUserIds ?? []).map(String),
    learningSecondaryAiUserIds: (config.learningSecondaryAiUserIds ?? []).map(String).filter((id) => (config.verifiedAiUserIds ?? []).map(String).includes(id)),
    revisitMrKeys: (config.revisitMrKeys ?? []).map(String),
  };
}

/** GET-only transport: never interpolates credentials, source text or endpoints into a shell. */
export function createGlabTransport(config) {
  return async (endpoint) => {
    try {
      const { stdout } = await execFileAsync(config.glabPath || 'glab', ['api', endpoint, '--hostname', config.host, '--method', 'GET', '--output', 'json'],
        { maxBuffer: config.maxResponseBytes ?? 64 * 1024 * 1024, timeout: config.requestTimeoutMs ?? 120000 });
      return JSON.parse(stdout);
    } catch (error) {
      // Do not echo subprocess stderr: it can contain credentials or private source text.
      throw new Error(`GET ${endpoint} failed (${error.code || error.name || 'transport error'})`, { cause: error });
    }
  };
}

export async function paginate(transport, endpoint, query = {}, { pageSize = 100, maxPages = 100000 } = {}) {
  const result = [];
  const seenPages = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ ...query, per_page: String(pageSize), page: String(page) });
    const address = `${endpoint}?${params}`;
    const items = asArray(await transport(address), address);
    if (items.length > pageSize) throw new Error(`Pagination exceeded requested page size at ${endpoint}`);
    if (items.length) {
      const signature = sha256(items);
      if (seenPages.has(signature)) throw new Error(`Repeated page at ${endpoint}; refusing incomplete coverage`);
      seenPages.add(signature);
      result.push(...items);
    }
    if (items.length < pageSize) return result;
  }
  throw new Error(`Pagination limit reached at ${endpoint}; refusing incomplete coverage`);
}

export function findingId(host, projectId, iid, discussionId, noteId, findingKey = '1') {
  return `gitlab:${host}:project:${projectId}:mr:${iid}:discussion:${encodeURIComponent(discussionId)}:note:${noteId}:finding:${encodeURIComponent(findingKey)}`;
}

export function classifyArea(file = '', text = '') {
  const filePath = (file || '').toLowerCase();
  if (/(^|\/)(\.github|\.gitlab|\.circleci|\.buildkite)(\/|$)|(^|\/)(\.gitlab-ci\.ya?ml|dockerfile|jenkinsfile|makefile|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|(^|\/)(ci|build)\//.test(filePath)) return 'CI/build';
  if (/\.(tsx|jsx|vue|svelte|css|scss|sass|less)$/.test(filePath) || /(^|\/)(frontend|client|components|pages|ui)\//.test(filePath)) return 'frontend';
  if (/\.(py|go|rb|java|kt|cs|sql|php)$/.test(filePath) || /(^|\/)(backend|server|api|migrations)\//.test(filePath)) return 'backend';
  // Text is retained for adjudication; ambiguous TypeScript and prose stay other.
  return 'other';
}

export function reviewerType(author, config, profile = null) {
  if ((config.verifiedAiUserIds || []).map(String).includes(String(author?.id))) return { type: 'ai', evidence: 'configured_stable_id' };
  if ((config.verifiedHumanUserIds || []).map(String).includes(String(author?.id))) return { type: 'human', evidence: 'configured_stable_id' };
  if ((config.verifiedServiceUserIds || []).map(String).includes(String(author?.id))) return { type: 'service', evidence: 'configured_stable_id' };
  if (author?.bot === true || profile?.bot === true) return { type: 'service', evidence: 'api_bot_field' };
  return { type: 'unknown', evidence: 'unverified_account_type' };
}

/** Narrow context labels; substantive or ambiguous notes remain candidates for adjudication. */
export function classifyNoteRole(note, discussion, config, profiles = {}) {
  const body = (note.body || '').trim();
  const plain = body.replace(/<!--[^]*?-->/g, '').trim();
  const accountType = reviewerType(note.author, config, profiles[note.author?.id]).type;
  const marker = /^<!--[^]*?\b(intro comment indicator|good job indicator|no diff indicator)\b[^]*?-->/.exec(body);
  if (marker && ['ai', 'service'].includes(accountType) && !note.resolvable && !note.position) {
    if (marker[1] === 'intro comment indicator' && !/```|\b(?:bug|vulnerability|regression|crash|defect)\b/i.test(plain)) return { noteRole: 'workflow_intro', candidateStatus: 'context_only', reason: 'Verified automation introduction marker; raw text retained' };
    if (marker[1] === 'good job indicator' && /^This (?:MR|merge request) was reviewed by [^\n]+ and no issues were found\.\s*Great job![\s\p{P}\p{S}]*$/u.test(plain)) return { noteRole: 'review_no_issues', candidateStatus: 'context_only', reason: 'Verified automation no-issues template; no defect established' };
    if (marker[1] === 'no diff indicator' && /^[\s\p{P}\p{S}]*No new changes since my last review\.\s*The code is the same as before\.[\s\p{P}\p{S}]*$/u.test(plain)) return { noteRole: 'review_unchanged', candidateStatus: 'context_only', reason: 'Verified automation unchanged-review template' };
  }
  if (/^(?:lgtm|looks good(?: to me)?|good job|great job|thanks|thank you|approved|nice work)[\s.!👍✅]*$/i.test(plain)) return { noteRole: 'praise_or_acknowledgement', candidateStatus: 'context_only', reason: 'Entire note is a short acknowledgement without a finding' };
  const priorReviewerNote = (discussion.notes || []).some((other) => other.id !== note.id && !other.system
    && String(other.author?.id) === String(note.author?.id) && Date.parse(other.created_at) < Date.parse(note.created_at));
  if (priorReviewerNote && /^(?:confirmed|verified|acknowledged|agreed)\b/i.test(plain)) {
    if (/^(?:confirmed|verified|acknowledged|agreed)[\s.!—-]*(?:fixed|addressed|resolved)?[\s.!]*(?:thanks[\s.!]*)?$/i.test(plain)) return { noteRole: 'confirmation_followup', candidateStatus: 'context_only', reason: 'Entire same-reviewer followup is a short confirmation' };
    return { noteRole: 'confirmation_followup', candidateStatus: 'needs_adjudication', reason: 'Confirmation-like followup may contain substantive detail; explicit context adjudication is required' };
  }
  if (['ai', 'service'].includes(accountType) && /^#{1,3}\s+.*(?:coverage|mutation).*report/i.test(plain)) return { noteRole: 'automated_report', candidateStatus: 'needs_adjudication', reason: 'Automation report is evidence, not an established accepted defect' };
  return { noteRole: 'review_candidate', candidateStatus: 'needs_adjudication', reason: 'External review text requires semantic adjudication' };
}

function sourceMatches(entry, mr, discussion, note) {
  const source = entry.source;
  return source && String(source.projectId) === String(mr.project_id) && String(source.mrIid) === String(mr.iid)
    && String(source.discussionId) === String(discussion.id) && String(source.noteId) === String(note.id);
}

function findQuote(notes, evidence, { requiredAuthorId } = {}) {
  if (!evidence || typeof evidence.quote !== 'string' || !evidence.quote.trim()) return null;
  return notes.find((note) => String(note.id) === String(evidence.noteId)
    && !note.system
    && (!requiredAuthorId || String(note.author?.id) === String(requiredAuthorId))
    && typeof note.body === 'string' && note.body.includes(evidence.quote)) || null;
}

function diffLines(diff, sign) {
  return (diff || '').split('\n').filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3))).map((line) => line.slice(1));
}

function patchHunks(patch) {
  if (!patch || patch.too_large || patch.collapsed || typeof patch.diff !== 'string') return null;
  const hunks = [];
  let hunk;
  for (const line of patch.diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (header) {
      hunk = { oldStart: Number(header[1]), oldCount: Number(header[2] ?? 1), newStart: Number(header[3]), newCount: Number(header[4] ?? 1), section: header[5], segments: [] };
      hunks.push(hunk);
    } else if (hunk && [' ', '+', '-'].includes(line[0])) {
      const kind = line[0] === ' ' ? 'context' : 'change';
      if (hunk.segments.at(-1)?.kind !== kind) hunk.segments.push(kind === 'context' ? { kind, lines: [] } : { kind, added: [], removed: [] });
      const segment = hunk.segments.at(-1);
      (kind === 'context' ? segment.lines : line[0] === '+' ? segment.added : segment.removed).push(line.slice(1));
    } else if (line !== '' && line !== '\\ No newline at end of file') return null;
  }
  if (!hunks.length) return null;
  for (const item of hunks) {
    const oldCount = item.segments.reduce((sum, segment) => sum + (segment.kind === 'context' ? segment.lines.length : segment.removed.length), 0);
    const newCount = item.segments.reduce((sum, segment) => sum + (segment.kind === 'context' ? segment.lines.length : segment.added.length), 0);
    if (oldCount !== item.oldCount || newCount !== item.newCount) return null;
  }
  return hunks;
}

function authorOwnedRevert(entry, { mr, discussion, note, raw, config }, commit) {
  const fail = (error) => ({ error });
  const acceptance = entry.acceptance;
  const reference = acceptance.revertMr;
  if (mr.state !== 'merged' || String(mr.author?.id) !== String(config.identity.id) || String(reference?.projectId) !== String(mr.project_id)
    || !Number.isSafeInteger(Number(reference?.mrIid)) || Number(reference.mrIid) <= 0 || String(reference.mrIid) === String(mr.iid)) return fail('Revert must reference a separate same-project author-owned MR for a merged source MR');
  const sourceNotes = [...new Map([...(raw.notes || []), ...(raw.discussions || []).flatMap((thread) => thread.notes || []), ...(discussion.notes || [])].map((source) => [String(source.id), source])).values()];
  const latest = sourceNotes.filter((source) => !source.system && String(source.author?.id) === String(config.identity.id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || compareIds(a.id, b.id)).at(-1);
  if (!Object.hasOwn(entry, 'reviewedThroughNoteId') || (latest ? String(entry.reviewedThroughNoteId) !== String(latest.id) : entry.reviewedThroughNoteId !== null)) return fail('Revert adjudication does not cover the latest nonsystem source-author note; null is required when none exists');
  const event = (evidence, body) => sourceNotes.find((source) => source.system === true && String(source.author?.id) === String(config.identity.id)
    && String(source.id) === String(evidence?.noteId) && evidence?.quote === body && source.body === evidence.quote);
  const action = event(acceptance.action, `mentioned in commit ${entry.fix.commitSha}`);
  const link = event(acceptance.mrLink, `mentioned in merge request !${reference.mrIid}`);
  if (!action || !link || String(action.id) === String(link.id)) return fail('Revert acceptance requires exact source-MR author system commit and MR-link events');
  const related = raw.revertMrs?.[`${reference.projectId}:${reference.mrIid}`];
  const revert = related?.metadata;
  if (!revert || mrKey(revert) !== `${mr.project_id}:${reference.mrIid}` || String(revert.author?.id) !== String(config.identity.id)
    || revert.state !== 'merged' || !mr.target_branch || revert.target_branch !== mr.target_branch) return fail('Revert MR must be author-owned, merged, same-project and on the source target branch');
  const listed = related.commits?.some((item) => item.id === entry.fix.commitSha);
  const associated = commit.associatedMrs?.some((item) => mrKey(item) === mrKey(revert));
  if (!listed && !associated) return fail('Fix commit is not verified as belonging to the referenced revert MR');
  if (typeof commit.metadata.message !== 'string' || !new RegExp(`^This reverts merge request !${mr.iid}\\.?$`, 'm').test(commit.metadata.message)) return fail('Revert commit message does not explicitly reverse the exact source MR');
  const dates = [note.created_at, action.created_at, link.created_at, revert.created_at, revert.merged_at, commit.metadata.committed_date, ...(latest ? [latest.created_at] : [])].map(Date.parse);
  if (dates.some((date) => !Number.isFinite(date))) return fail('Revert evidence timestamps are unavailable');
  const [reviewAt, actionAt, linkAt, createdAt, mergedAt, committedAt] = dates;
  if ([actionAt, linkAt, createdAt, committedAt].some((date) => date < reviewAt) || actionAt < committedAt || linkAt < createdAt || mergedAt < Math.max(createdAt, committedAt, actionAt, linkAt)) return fail('Revert action, linkage, creation, merge or commit chronology is invalid');
  // ponytail: single-file reversals only; use a per-file proof if multi-file reverts need ingestion.
  if (String(mr.changes_count) !== '1' || String(revert.changes_count) !== '1' || raw.diffs?.length !== 1 || commit.diffs?.length !== 1 || related.diffs?.length !== 1) return fail('Author-owned revert mode requires complete single-file source, revert MR and fix commit patches');
  const original = raw.diffs[0], correction = commit.diffs[0], mergedPatch = related.diffs[0];
  if ([original, correction, mergedPatch].some((patch) => patch.old_path !== entry.fix.file || patch.new_path !== entry.fix.file)) return fail('Revert must reverse the exact same source file without a rename');
  const originalHunks = patchHunks(original), correctionHunks = patchHunks(correction), mergedHunks = patchHunks(mergedPatch);
  if (!originalHunks || !correctionHunks || !mergedHunks) return fail('Revert/source patch is absent, truncated or has incomplete hunk counts');
  const reversed = originalHunks.map((hunk) => ({ ...hunk, oldStart: hunk.newStart, oldCount: hunk.newCount, newStart: hunk.oldStart, newCount: hunk.oldCount,
    segments: hunk.segments.map((segment) => segment.kind === 'context' ? segment : { kind: 'change', added: segment.removed, removed: segment.added }) }));
  if (JSON.stringify(reversed) !== JSON.stringify(correctionHunks) || JSON.stringify(mergedHunks) !== JSON.stringify(correctionHunks)) return fail('Actual correction is not the exact complete reverse source hunk and merged revert patch');
  const added = diffLines(correction.diff, '+'), removed = diffLines(correction.diff, '-');
  if (JSON.stringify(entry.fix.addedLines || []) !== JSON.stringify(added) || JSON.stringify(entry.fix.removedLines || []) !== JSON.stringify(removed)) return fail('Revert manifest must cite every exact added and removed correction line');
  if (commit.metadata.stats?.additions !== added.length || commit.metadata.stats?.deletions !== removed.length || commit.metadata.stats?.total !== added.length + removed.length) return fail('Revert commit statistics do not establish complete single-file correction coverage');
  return { acceptance: { kind: 'author_owned_revert', action: { noteId: action.id, quote: acceptance.action.quote, url: `${mr.web_url}#note_${action.id}` },
    mrLink: { noteId: link.id, quote: acceptance.mrLink.quote, url: `${mr.web_url}#note_${link.id}` }, revertMr: { projectId: revert.project_id, mrIid: revert.iid, url: revert.web_url, authorId: revert.author.id, createdAt: revert.created_at, mergedAt: revert.merged_at, targetBranch: revert.target_branch } },
    reviewedThroughNoteId: latest?.id ?? null, association: { kind: 'author_owned_revert_mr', mrKey: mrKey(revert), url: revert.web_url, membership: listed ? 'revert_mr_commits' : 'commit_api_association' } };
}

// Retention is a fresh semantic judgment, separately pinned from the historical corrective diff.
function verifyRetention(entry, raw, mr) {
  const proof = entry.finalRetention;
  const key = entry.acceptance?.kind === 'author_owned_revert'
    ? `${mr.project_id}:${entry.acceptance.revertMr?.mrIid}` : mrKey(mr);
  const source = raw.finalSources?.[key];
  if (!proof || proof.outcome !== 'retained' || !proof.reason?.trim()) return { error: 'Final semantic retained outcome is missing; removed/reverted histories cannot support positive learning' };
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(source?.revision || '') || source.changedDuringCollection || proof.revision !== source.revision
    || source.revision !== (key === mrKey(mr) ? mr.sha : raw.revertMrs?.[key]?.metadata?.sha)) return { error: 'Final reviewed revision changed or is unavailable; renew retention proof' };
  if (proof.validation?.status !== 'passed' || proof.validation.revision !== proof.revision || !proof.validation.evidence?.trim()) return { error: 'Final retention requires passed validation evidence at the reviewed revision' };
  if (!Array.isArray(proof.files) || !proof.files.length) return { error: 'Final source/blob evidence is missing' };
  for (const file of proof.files) {
    const actual = source.files?.[file.file];
    if (!actual || actual.error || actual.truncated || actual.collapsed || actual.too_large || actual.encoding !== 'base64'
      || actual.file_path !== file.file || actual.commit_id !== proof.revision || actual.ref !== proof.revision || !/^[a-f0-9]{64}$/.test(file.contentSha256 || '') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.blobId || '')
      || !Number.isSafeInteger(actual.size) || actual.size < 0 || typeof actual.content !== 'string') return { error: 'Final source evidence is absent, collapsed, truncated or incomplete' };
    const encoded = actual.content.replace(/\n/g, '');
    const bytes = Buffer.from(encoded, 'base64');
    const blobId = createHash(file.blobId.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (bytes.toString('base64') !== encoded || bytes.length !== actual.size || sha256(bytes) !== file.contentSha256
      || actual.blob_id !== file.blobId || blobId !== file.blobId
      || (actual.content_sha256 && actual.content_sha256 !== file.contentSha256)) return { error: 'Final source/blob hash or completeness mismatch; renew retention proof' };
  }
  return { proof: { ...proof, mrKey: key } };
}

/** A manifest is an explicit semantic adjudication. We verify its cited source and actual correction, not prose sentiment. */
export function verifyAdjudication(entry, { mr, discussion, note, raw, config }) {
  if (!entry || !DISPOSITIONS.has(entry.disposition)) return { disposition: note.resolvable && !note.resolved ? 'unresolved' : 'uncertain', verified: false, reason: 'No explicit valid adjudication; resolved flags are not acceptance' };
  if (entry.area && !AREAS.has(entry.area)) return { disposition: 'uncertain', verified: false, reason: 'Invalid adjudicated area' };
  const threadNotes = discussion.notes || [];
  const latestAuthorNote = threadNotes.filter((n) => !n.system && String(n.author?.id) === String(config.identity.id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || compareIds(a.id, b.id)).at(-1);
  if (entry.disposition !== 'accepted_and_fixed') {
    const cited = findQuote(threadNotes, entry.evidence);
    if (!cited && entry.disposition !== 'duplicate') return { disposition: 'uncertain', verified: false, reason: 'Exclusion lacks verifiable quoted source evidence' };
    if (entry.disposition === 'duplicate' && !entry.duplicateOf) return { disposition: 'uncertain', verified: false, reason: 'Duplicate lacks a stable canonical finding ID' };
    return { disposition: entry.disposition, verified: Boolean(cited || entry.duplicateOf), reason: entry.reason || entry.disposition,
      evidence: cited ? { noteId: cited.id, url: `${mr.web_url}#note_${cited.id}`, quote: entry.evidence.quote } : { duplicateOf: entry.duplicateOf } };
  }
  const reject = (reason) => ({ disposition: 'uncertain', verified: false, reason });
  if (!entry.reason?.trim()) return reject('Acceptance requires a semantic adjudication reason');
  const revertMode = entry.acceptance?.kind === 'author_owned_revert';
  const acceptanceNote = revertMode ? null : findQuote(threadNotes, entry.acceptance, { requiredAuthorId: config.identity.id });
  if (!revertMode) {
    if (!acceptanceNote) return reject('Acceptance is not backed by a quoted author reply');
    if (!Number.isFinite(Date.parse(acceptanceNote.created_at)) || !Number.isFinite(Date.parse(note.created_at))) return reject('Finding or acceptance timestamp is unavailable');
    if (Date.parse(acceptanceNote.created_at) < Date.parse(note.created_at)) return reject('Acceptance reply predates the finding');
    if (!latestAuthorNote || String(entry.reviewedThroughNoteId) !== String(latestAuthorNote.id)) return reject('Adjudication does not cover the latest author reply; re-adjudicate the thread');
  }
  const fix = entry.fix;
  if (!fix?.commitSha || !fix.file || !fix.correction?.trim()) return reject('Fix requires commit SHA, file and correction explanation');
  const commit = raw.fixCommits?.[fix.commitSha];
  if (!commit || commit.metadata?.id !== fix.commitSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(fix.commitSha)) return reject('Fix commit is not verified as a complete actual commit SHA');
  let association = { kind: 'current_mr_commits_or_api_association' };
  let revertEvidence;
  if (revertMode) {
    revertEvidence = authorOwnedRevert(entry, { mr, discussion, note, raw, config }, commit);
    if (revertEvidence.error) return reject(revertEvidence.error);
    association = revertEvidence.association;
  } else if (!commit.belongsToMr) {
    const linkedReply = findQuote(threadNotes, fix.mrLink, { requiredAuthorId: config.identity.id });
    const exactShaPattern = new RegExp(`(^|[^a-f0-9])${fix.commitSha}([^a-f0-9]|$)`, 'i');
    if (!linkedReply || !exactShaPattern.test(fix.mrLink.quote)) return reject('Fix commit is not verified as belonging to this MR; historical linkage requires a same-thread author quote containing the exact full SHA');
    if (!Number.isFinite(Date.parse(linkedReply.created_at)) || Date.parse(linkedReply.created_at) < Date.parse(note.created_at)) return reject('Historical fix-link reply is undated or predates the finding');
    association = { kind: 'author_linked_historical_fix', noteId: linkedReply.id, quote: fix.mrLink.quote,
      url: `${mr.web_url}#note_${linkedReply.id}`, currentApiAssociation: false };
  }
  if (Date.parse(commit.metadata?.committed_date) < Date.parse(note.created_at)) return reject('Fix commit predates the finding');
  if (!Number.isFinite(Date.parse(commit.metadata?.committed_date))) return reject('Fix commit timestamp is unavailable');
  const originalFile = note.position?.new_path || note.position?.old_path;
  if (originalFile && originalFile !== fix.file && !fix.crossFileReason?.trim()) return reject('Fix targets a different file without an explicit relationship explanation');
  const diff = commit.diffs?.find((d) => d.new_path === fix.file || d.old_path === fix.file);
  if (!diff || diff.too_large || diff.collapsed || typeof diff.diff !== 'string' || !diff.diff) return reject('Fix diff is absent, collapsed or truncated');
  const added = fix.addedLines || [];
  const removed = fix.removedLines || [];
  if (!Array.isArray(added) || !Array.isArray(removed) || added.length + removed.length === 0) return reject('Fix requires exact added or removed code/config/test lines');
  if (![...added, ...removed].every((line) => typeof line === 'string' && line.trim())) return reject('Fix line evidence must be nonempty strings');
  if (!added.every((line) => diffLines(diff.diff, '+').includes(line)) || !removed.every((line) => diffLines(diff.diff, '-').includes(line))) return reject('Claimed correction is not present in the actual commit diff');
  if (fix.diffSha256 && fix.diffSha256 !== sha256(diff.diff)) return reject('Fix diff hash mismatch');
  const retention = verifyRetention(entry, raw, mr);
  if (retention.error) return reject(retention.error);
  return { disposition: 'accepted_and_fixed', verified: true, reason: entry.reason,
    evidence: { retention: retention.proof, acceptance: revertMode ? revertEvidence.acceptance : { noteId: acceptanceNote.id, quote: entry.acceptance.quote, url: `${mr.web_url}#note_${acceptanceNote.id}` },
      reviewedThroughNoteId: revertMode ? revertEvidence.reviewedThroughNoteId : latestAuthorNote.id,
      fix: { commitSha: fix.commitSha, file: fix.file, correction: fix.correction, addedLines: added, removedLines: removed,
        association,
        diffSha256: sha256(diff.diff), url: commit.metadata.web_url || `${mr.web_url.split('/-/merge_requests/')[0]}/-/commit/${fix.commitSha}` } } };
}

export function extractReviewNotes(raw, config, adjudications = { findings: [] }, profiles = {}) {
  const entries = adjudications.findings || [];
  const findings = [];
  const notesInDiscussions = new Set(raw.discussions.flatMap((d) => d.notes || []).map((n) => String(n.id)));
  const discussions = [...raw.discussions, ...raw.notes.filter((n) => !notesInDiscussions.has(String(n.id))).map((note) => ({ id: `standalone-${note.id}`, notes: [note], individual_note: true }))];
  for (const discussion of discussions) {
    for (const note of discussion.notes || []) {
      if (note.system || !note.author?.id || String(note.author.id) === String(config.identity.id)) continue;
      const matches = entries.filter((entry) => sourceMatches(entry, raw.metadata, discussion, note));
      const contextEntry = (adjudications.nonFindingNotes || []).find((entry) => sourceMatches(entry, raw.metadata, discussion, note));
      const citedContext = contextEntry ? findQuote(discussion.notes || [], contextEntry.evidence) : null;
      if (contextEntry && (!citedContext || String(citedContext.id) !== String(note.id) || !contextEntry.reason?.trim())) throw new Error(`Invalid context-only adjudication for note ${note.id}`);
      const role = matches.length ? { noteRole: 'review_candidate', candidateStatus: 'adjudicated', reason: 'Explicit finding adjudication' }
        : citedContext ? { noteRole: contextEntry.noteRole || 'adjudicated_context', candidateStatus: 'context_only', reason: contextEntry.reason }
          : classifyNoteRole(note, discussion, config, profiles);
      const outcomes = matches.length ? matches : [null];
      for (const entry of outcomes) {
        const id = findingId(config.host, raw.metadata.project_id, raw.metadata.iid, discussion.id, note.id, entry?.findingKey || '1');
        if (entry?.findingId && entry.findingId !== id) throw new Error(`Adjudication findingId mismatch for note ${note.id}`);
        const outcome = verifyAdjudication(entry, { mr: raw.metadata, discussion, note, raw, config });
        const file = note.position?.new_path || note.position?.old_path || entry?.fix?.file || null;
        const reviewer = { id: note.author.id, username: note.author.username || null, name: note.author.name || null,
          ...reviewerType(note.author, config, profiles[note.author.id]) };
        const learningCohort = reviewer.type === 'human' ? 'human'
          : reviewer.type === 'ai' && (config.learningSecondaryAiUserIds || []).includes(String(reviewer.id)) ? 'secondary_ai' : null;
        findings.push({ findingId: id, canonicalFindingId: entry?.canonicalFindingId || entry?.duplicateOf || id,
          projectId: raw.metadata.project_id, mrIid: raw.metadata.iid, mrKey: mrKey(raw.metadata), mrUrl: raw.metadata.web_url,
          discussionId: discussion.id, noteId: note.id, sourceUrl: `${raw.metadata.web_url}#note_${note.id}`,
          originalText: note.body, summary: entry?.summary || null, pattern: entry?.pattern || null,
          reviewer, learningCohort,
          file, revision: note.position?.head_sha || note.commit_id || raw.metadata.sha || null, position: note.position || null,
          createdAt: note.created_at, updatedAt: note.updated_at, retrievedAt: raw.retrievedAt,
          noteRole: role.noteRole, candidateStatus: role.candidateStatus, candidateReason: role.reason,
          area: entry?.area || classifyArea(file, note.body), tags: entry?.tags || [],
          resolved: Boolean(note.resolved), disposition: outcome.disposition, reason: outcome.reason,
          learningEligible: outcome.disposition === 'accepted_and_fixed' && outcome.verified && Boolean(learningCohort),
          evidenceVerified: outcome.verified, evidence: outcome.evidence || null,
          threadNoteIds: (discussion.notes || []).map((n) => n.id),
        });
      }
    }
  }
  const ids = new Set();
  for (const finding of findings) {
    if (ids.has(finding.findingId)) throw new Error(`Duplicate finding key: ${finding.findingId}`);
    ids.add(finding.findingId);
  }
  return findings.sort((a, b) => a.findingId.localeCompare(b.findingId));
}

export function extractFindings(raw, config, adjudications = { findings: [] }, profiles = {}) {
  return extractReviewNotes(raw, config, adjudications, profiles).filter((note) => note.candidateStatus !== 'context_only');
}

export async function atomicWriteJson(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  try {
    await fs.rename(temporary, filename);
    const directory = await fs.open(path.dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

async function readJsonIfExists(filename) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function ensureIdentity(value, expected, label) {
  if (String(value?.id) !== String(expected.id) || value?.username !== expected.username) throw new Error(`${label} identity does not match configured stable ID and username`);
}

function summarizeChanges(previous, current) {
  const before = new Map((previous?.findings || []).map((f) => [f.findingId, f]));
  const after = new Map(current.findings.map((f) => [f.findingId, f]));
  const comparable = (value) => { const { retrievedAt, ...rest } = value; return sha256(rest); };
  const changes = { newFindingIds: [], changedFindingIds: [], acceptedAddedIds: [], acceptedRemovedIds: [] };
  for (const [id, finding] of after) {
    if (!before.has(id)) changes.newFindingIds.push(id);
    else if (comparable(finding) !== comparable(before.get(id))) changes.changedFindingIds.push(id);
    if (finding.learningEligible && !before.get(id)?.learningEligible) changes.acceptedAddedIds.push(id);
  }
  for (const [id, finding] of before) if (finding.learningEligible && !after.get(id)?.learningEligible) changes.acceptedRemovedIds.push(id);
  return changes;
}

export function acceptanceGroups(findings) {
  const grouped = new Map();
  const contribute = (group, finding) => {
    group.memberFindingIds.push(finding.findingId);
    if (!group.contributors.some((r) => String(r.id) === String(finding.reviewer.id))) group.contributors.push(finding.reviewer);
    if (!group.mrKeys.includes(finding.mrKey)) group.mrKeys.push(finding.mrKey);
    if (!group.areas.includes(finding.area)) group.areas.push(finding.area);
  };
  for (const finding of findings.filter((f) => f.learningEligible && f.evidenceVerified && f.evidence?.retention?.outcome === 'retained' && f.learningCohort)) {
    const key = finding.canonicalFindingId;
    const group = grouped.get(key) || { findingId: key, memberFindingIds: [], contributors: [], mrKeys: [], areas: [] };
    contribute(group, finding);
    grouped.set(key, group);
  }
  for (const finding of findings.filter((f) => f.disposition === 'duplicate' && f.evidenceVerified && f.learningCohort)) {
    const group = grouped.get(finding.canonicalFindingId);
    if (group && group.mrKeys.includes(finding.mrKey)) contribute(group, finding);
  }
  return [...grouped.values()].sort((a, b) => Number(b.contributors.some((r) => r.type === 'human')) - Number(a.contributors.some((r) => r.type === 'human')) || a.findingId.localeCompare(b.findingId));
}

async function collectMr(transport, mr, config, adjudications, retrievedAt) {
  const endpoint = `projects/${mr.project_id}/merge_requests/${mr.iid}`;
  const metadata = await transport(endpoint);
  ensureIdentity(metadata.author, config.identity, `MR ${mrKey(mr)} author`);
  if (mrKey(metadata) !== mrKey(mr) || !metadata.web_url) throw new Error(`Invalid MR detail for ${mrKey(mr)}`);
  const [discussions, notes, commits, diffs] = await Promise.all(['discussions', 'notes', 'commits', 'diffs'].map((resource) => paginate(transport, `${endpoint}/${resource}`, {}, config)));
  const raw = { schemaVersion: 1, retrievedAt, metadata, discussions, notes, commits, diffs, fixCommits: {} };
  const acceptedEntries = (adjudications.findings || []).filter((e) => String(e.source?.projectId) === String(mr.project_id)
    && String(e.source?.mrIid) === String(mr.iid) && e.disposition === 'accepted_and_fixed');
  for (const entry of acceptedEntries.filter((e) => e.acceptance?.kind === 'author_owned_revert')) {
    const reference = entry.acceptance.revertMr;
    if (String(reference?.projectId) !== String(mr.project_id) || !Number.isSafeInteger(Number(reference?.mrIid)) || Number(reference.mrIid) <= 0 || String(reference.mrIid) === String(mr.iid)) throw new Error(`Invalid adjudicated same-project revert MR for ${mrKey(mr)}`);
    const key = `${reference.projectId}:${reference.mrIid}`;
    raw.revertMrs ||= {};
    if (raw.revertMrs[key]) continue;
    const relatedEndpoint = `projects/${mr.project_id}/merge_requests/${reference.mrIid}`;
    const relatedMetadata = await transport(relatedEndpoint);
    if (mrKey(relatedMetadata) !== key || !relatedMetadata.web_url) throw new Error(`Invalid related revert MR detail for ${key}`);
    const [relatedCommits, relatedDiffs] = await Promise.all(['commits', 'diffs'].map((resource) => paginate(transport, `${relatedEndpoint}/${resource}`, {}, config)));
    raw.revertMrs[key] = { retrievedAt, metadata: relatedMetadata, commits: relatedCommits, diffs: relatedDiffs };
  }
  const fixShas = [...new Set(acceptedEntries.map((e) => e.fix?.commitSha).filter(Boolean))];
  for (const sha of fixShas) {
    if (!/^[a-f0-9]{7,64}$/i.test(sha)) throw new Error(`Invalid adjudicated commit SHA for MR ${mrKey(mr)}`);
    const commitEndpoint = `projects/${mr.project_id}/repository/commits/${encodeURIComponent(sha)}`;
    const commit = await transport(commitEndpoint);
    if (String(commit.id) !== sha) throw new Error(`Fix commit SHA must be the complete verified SHA for MR ${mrKey(mr)}`);
    const commitDiffs = await paginate(transport, `${commitEndpoint}/diff`, {}, config);
    let belongsToMr = commits.some((c) => c.id === sha);
    let associatedMrs = null;
    if (!belongsToMr) {
      associatedMrs = await paginate(transport, `${commitEndpoint}/merge_requests`, {}, config);
      belongsToMr = associatedMrs.some((associated) => mrKey(associated) === mrKey(mr));
    }
    raw.fixCommits[sha] = { metadata: commit, diffs: commitDiffs, belongsToMr, associatedMrs };
  }
  raw.finalSources = {};
  for (const entry of acceptedEntries) {
    const reference = entry.acceptance?.kind === 'author_owned_revert' ? entry.acceptance.revertMr : { projectId: mr.project_id, mrIid: mr.iid };
    const key = `${reference.projectId}:${reference.mrIid}`;
    const finalMr = key === mrKey(metadata) ? metadata : raw.revertMrs?.[key]?.metadata;
    const revision = finalMr?.sha;
    const source = raw.finalSources[key] ||= { revision, files: {} };
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision || '')) continue;
    for (const file of entry.finalRetention?.files || []) {
      if (typeof file.file !== 'string' || !file.file || Object.hasOwn(source.files, file.file)) continue;
      try {
        source.files[file.file] = await transport(`projects/${mr.project_id}/repository/files/${encodeURIComponent(file.file)}?ref=${revision}`);
      } catch { source.files[file.file] = { error: 'Final file unavailable; retention remains uncertain' }; }
    }
  }
  // Recheck after file retrieval: a moving head cannot certify a stale snapshot.
  for (const [key, source] of Object.entries(raw.finalSources)) {
    const current = await transport(`projects/${key.replace(':', '/merge_requests/')}`);
    source.changedDuringCollection = current.sha !== source.revision;
  }
  return raw;
}

/** Writes run evidence first and advances the single authoritative pointer only after success. */
export async function runCollector({ config: inputConfig, output, adjudications = { schemaVersion: 1, findings: [] }, transport, now = () => new Date() }) {
  const config = validateConfig(inputConfig);
  if (!output) throw new Error('An output directory is required');
  if (adjudications.schemaVersion !== 1 || !Array.isArray(adjudications.findings)) throw new Error('Adjudications must have schemaVersion 1 and findings array');
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const lockPath = path.join(output, '.collector.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('Collector lock exists; inspect the running process before removing a stale lock'); throw error; }
  const startedAt = iso(now().toISOString());
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = path.join(output, 'runs', runId);
  const relativeRun = path.join('runs', runId);
  const statePath = path.join(output, 'state.json');
  const summary = { schemaVersion: 1, runId, startedAt, status: 'running', host: config.host, identity: config.identity,
    discovery: { status: 'not_started' }, extraction: { status: 'not_started', extractedMrCount: 0 }, warnings: [], errors: [] };
  const get = transport || createGlabTransport(config);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt, runId }));
    await lock.sync();
    await fs.mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const state = await readJsonIfExists(statePath);
    const sourceFingerprint = sha256({ host: config.host, identity: config.identity });
    if (state && state.sourceFingerprint !== sourceFingerprint) throw new Error('Existing checkpoint belongs to a different configured identity/host');
    const previous = state ? await readJsonIfExists(path.join(output, state.corpusPath)) : null;
    if (state && !previous) throw new Error('Checkpoint corpus is missing; refusing to interpret missing source as empty');
    const authenticated = await get('user');
    ensureIdentity(authenticated, config.identity, 'Authenticated');
    const user = await get(`users/${config.identity.id}`);
    ensureIdentity(user, config.identity, 'Source');
    const minimalIdentity = (identity) => ({ id: identity.id, username: identity.username });
    await atomicWriteJson(path.join(runDirectory, 'identity.json'), { schemaVersion: 1, host: config.host, retrievedAt: startedAt,
      authenticated: minimalIdentity(authenticated), user: minimalIdentity(user) });
    const updatedAfter = state ? new Date(Date.parse(state.successfulCheckpoint) - config.overlapSeconds * 1000).toISOString() : null;
    summary.interval = { since: updatedAfter || config.initialSince, through: startedAt };
    summary.previousCheckpoint = state?.successfulCheckpoint || null;
    summary.checkpoint = state?.successfulCheckpoint || null;
    const query = { scope: 'all', state: 'all', author_id: String(config.identity.id), order_by: state ? 'updated_at' : 'created_at', sort: 'asc',
      ...(updatedAfter ? { updated_after: updatedAfter, updated_before: startedAt } : { created_before: startedAt }) };
    summary.discovery.status = 'running';
    const discovered = await paginate(get, 'merge_requests', query, config);
    const discoveredByKey = new Map();
    for (const mr of discovered) {
      ensureIdentity(mr.author, config.identity, `Discovered MR ${mrKey(mr)} author`);
      if (!Number.isInteger(mr.project_id) || !Number.isInteger(mr.iid) || !mr.web_url) throw new Error('Discovery contains invalid MR metadata');
      discoveredByKey.set(mrKey(mr), mr);
    }
    summary.discovery = { status: 'success', mode: state ? 'incremental' : 'all_authored_metadata', updatedAfter,
      discoveredMrCount: discoveredByKey.size, states: [...new Set(discovered.map((mr) => mr.state))].sort(), scope: 'all_accessible_projects' };
    await atomicWriteJson(path.join(runDirectory, 'source-discovery.json'), { schemaVersion: 1, retrievedAt: startedAt, host: config.host,
      identity: config.identity, query, coverage: summary.discovery, mergeRequests: [...discoveredByKey.values()] });
    const allMetadata = new Map((previous?.mergeRequests || []).map((record) => [record.mrKey, record]));
    for (const [key, mr] of discoveredByKey) allMetadata.set(key, { ...allMetadata.get(key), mrKey: key, metadata: mr, discoveredAt: startedAt });
    const revisitKeys = new Set([...config.revisitMrKeys, ...(previous?.revisitMrKeys || []),
      ...(previous?.findings || []).filter((finding) => finding.learningEligible).map((finding) => finding.mrKey),
      ...(previous?.mergeRequests || []).filter((record) => record.metadata.state === 'opened').map((record) => record.mrKey)]);
    for (const entry of adjudications.findings) if (entry.source?.projectId && entry.source?.mrIid) revisitKeys.add(`${entry.source.projectId}:${entry.source.mrIid}`);
    const selected = new Map();
    for (const [key, mr] of discoveredByKey) {
      if (state || !config.initialSince || Date.parse(mr.updated_at) >= Date.parse(config.initialSince) || Date.parse(mr.created_at) >= Date.parse(config.initialSince)
        || (config.initialIncludeOpen && mr.state === 'opened')) selected.set(key, mr);
    }
    for (const key of revisitKeys) {
      if (selected.has(key)) continue;
      const existing = allMetadata.get(key)?.metadata;
      if (existing) selected.set(key, existing);
      else {
        const match = /^(\d+):(\d+)$/.exec(key);
        if (!match) throw new Error(`Invalid revisit MR key: ${key}`);
        const mr = await get(`projects/${match[1]}/merge_requests/${match[2]}`);
        ensureIdentity(mr.author, config.identity, `Revisit MR ${key} author`);
        selected.set(key, mr);
        allMetadata.set(key, { mrKey: key, metadata: mr, discoveredAt: startedAt });
      }
    }
    summary.extraction = { status: 'running', selectedMrCount: selected.size, extractedMrCount: 0, revisitMrCount: [...selected.keys()].filter((key) => revisitKeys.has(key)).length };
    const observations = new Map([...(previous?.findings || []), ...(previous?.nonFindingNotes || [])].map((finding) => [finding.findingId, finding]));
    const profiles = {};
    const profileErrors = {};
    for (const [key, mr] of [...selected].sort(([a], [b]) => compareIds(a, b))) {
      const priorRawPath = allMetadata.get(key)?.rawPath;
      const raw = await collectMr(get, mr, config, adjudications, startedAt);
      const authorObjects = [...raw.discussions.flatMap((d) => d.notes || []), ...raw.notes].map((n) => n.author).filter((a) => a?.id);
      if (config.fetchReviewerProfiles !== false) {
        for (const author of authorObjects) {
          if (String(author.id) === String(config.identity.id) || profiles[author.id] || profileErrors[author.id]
            || reviewerType(author, config).type !== 'unknown') continue;
          try {
            const profile = await get(`users/${author.id}`);
            if (String(profile.id) !== String(author.id)) throw new Error('Profile identity mismatch');
            profiles[author.id] = { id: profile.id, username: profile.username, ...(typeof profile.bot === 'boolean' ? { bot: profile.bot } : {}) };
          } catch { profileErrors[author.id] = 'Reviewer profile unavailable; account attribution remains unknown'; }
        }
      }
      const rawPath = path.join(relativeRun, 'raw', `${key.replace(':', '-')}.json`);
      await atomicWriteJson(path.join(output, rawPath), raw);
      allMetadata.set(key, { ...allMetadata.get(key), mrKey: key, metadata: raw.metadata, retrievedAt: startedAt,
        extractionStatus: 'success', rawPath, rawSha256: sha256(raw), currentDiffLimitations: raw.diffs.filter((d) => d.too_large || d.collapsed).map((d) => d.new_path || d.old_path) });
      const currentNoteIds = new Set([...raw.discussions.flatMap((discussion) => discussion.notes || []), ...raw.notes].map((note) => String(note.id)));
      const missingNotes = [];
      for (const [id, finding] of observations) {
        if (finding.mrKey !== key) continue;
        observations.delete(id);
        if (finding.candidateStatus !== 'context_only' && !currentNoteIds.has(String(finding.noteId))) missingNotes.push({ ...finding,
          candidateStatus: 'needs_adjudication', disposition: 'uncertain', learningEligible: false, evidenceVerified: false,
          sourceMissing: true, sourceMissingAt: finding.sourceMissingAt || startedAt, archivedSourcePath: finding.archivedSourcePath || priorRawPath,
          reason: 'Previously observed note is absent from complete current source; original evidence retained for audit', retrievedAt: startedAt });
      }
      for (const finding of missingNotes) observations.set(finding.findingId, finding);
      for (const finding of extractReviewNotes(raw, config, adjudications, profiles)) observations.set(finding.findingId, finding);
      summary.extraction.extractedMrCount++;
    }
    await atomicWriteJson(path.join(runDirectory, 'reviewer-profiles.json'), { schemaVersion: 1, retrievedAt: startedAt, profiles, errors: profileErrors });
    summary.warnings.push(...Object.entries(profileErrors).map(([id, reason]) => ({ reviewerId: id, reason })));
    for (const record of allMetadata.values()) if (!record.extractionStatus) record.extractionStatus = 'deferred';
    const allReviewNotes = [...observations.values()].sort((a, b) => a.findingId.localeCompare(b.findingId));
    const findings = allReviewNotes.filter((note) => note.candidateStatus !== 'context_only');
    const nonFindingNotes = allReviewNotes.filter((note) => note.candidateStatus === 'context_only');
    const newRevisitKeys = new Set(config.revisitMrKeys);
    for (const record of allMetadata.values()) if (record.metadata.state === 'opened') newRevisitKeys.add(record.mrKey);
    // Recheck accepted heads too, even when updated_at or author replies do not advance.
    for (const finding of findings) newRevisitKeys.add(finding.mrKey);
    const acceptedGroups = acceptanceGroups(findings);
    const corpus = { schemaVersion: 1, runId, retrievedAt: startedAt, host: config.host, identity: config.identity,
      initialSince: previous?.initialSince || config.initialSince, mergeRequests: [...allMetadata.values()].sort((a, b) => compareIds(a.mrKey, b.mrKey)),
      findings, nonFindingNotes, acceptedGroups, revisitMrKeys: [...newRevisitKeys].sort(compareIds),
      coverage: { discoveredTotal: allMetadata.size, everExtracted: [...allMetadata.values()].filter((r) => r.extractionStatus === 'success').length,
        deferredMrKeys: [...allMetadata.values()].filter((r) => r.extractionStatus === 'deferred').map((r) => r.mrKey),
        extractionScope: 'Initial window plus open MRs, then incremental updates and retained revisit queue; older closed history may be deferred',
        reviewerAttributionErrors: profileErrors } };
    const changes = summarizeChanges(previous, corpus);
    summary.status = 'success';
    summary.finishedAt = iso(now().toISOString());
    summary.extraction.status = 'success';
    summary.coverage = corpus.coverage;
    summary.changes = changes;
    summary.newAcceptedIds = changes.acceptedAddedIds;
    summary.checkpoint = startedAt;
    summary.counts = { observedExternalNotes: allReviewNotes.length, contextOnlyNotes: nonFindingNotes.length,
      findingCandidates: findings.length, acceptedFindings: acceptedGroups.length,
      reviewCandidateMrCount: new Set(findings.filter((f) => f.noteRole === 'review_candidate' || !f.noteRole).map((f) => f.mrKey)).size,
      confirmationFollowupCandidates: findings.filter((f) => f.noteRole === 'confirmation_followup').length,
      automatedReportCandidates: findings.filter((f) => f.noteRole === 'automated_report').length,
      candidateCountInterpretation: 'Unadjudicated review notes are candidates, not proven actionable defects',
      acceptedMrCount: new Set(findings.filter((f) => f.learningEligible).map((f) => f.mrKey)).size,
      dispositions: Object.fromEntries([...DISPOSITIONS].map((disposition) => [disposition, findings.filter((f) => f.disposition === disposition).length])),
      reviewerTypes: Object.fromEntries(['human', 'ai', 'service', 'unknown'].map((type) => [type, findings.filter((f) => f.reviewer.type === type).length])) };
    summary.meaningfulChange = Object.values(changes).some((ids) => ids.length) || summary.warnings.length > 0;
    const corpusPath = path.join(relativeRun, 'corpus.json');
    await atomicWriteJson(path.join(output, corpusPath), corpus);
    await atomicWriteJson(path.join(runDirectory, 'summary.json'), summary);
    await atomicWriteJson(statePath, { schemaVersion: 1, sourceFingerprint, successfulCheckpoint: startedAt, runId, corpusPath,
      summaryPath: path.join(relativeRun, 'summary.json'), adjudicationsSha256: sha256(adjudications), sourceDiscoveryPath: path.join(relativeRun, 'source-discovery.json') });
    return { summary, statePath, corpusPath: path.join(output, corpusPath), summaryPath: path.join(runDirectory, 'summary.json') };
  } catch (error) {
    summary.status = 'failed';
    summary.finishedAt = iso(now().toISOString());
    summary.errors.push({ message: error.message });
    if (summary.discovery.status === 'running') summary.discovery.status = 'failed';
    if (summary.extraction.status === 'running') summary.extraction.status = 'failed';
    summary.checkpointAdvanced = false;
    summary.checkpoint = summary.previousCheckpoint || null;
    await atomicWriteJson(path.join(runDirectory, 'summary.json'), summary);
    return { summary, statePath, summaryPath: path.join(runDirectory, 'summary.json') };
  } finally {
    await lock.close();
    await fs.rm(lockPath);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (!['--config', '--output', '--adjudications'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: collector.mjs --config config.json --output private-directory [--adjudications evidence.json]');
    options[args[index].slice(2)] = args[++index];
  }
  if (!options.config || !options.output) throw new Error('--config and --output are required');
  const config = JSON.parse(await fs.readFile(options.config, 'utf8'));
  const adjudications = options.adjudications ? JSON.parse(await fs.readFile(options.adjudications, 'utf8')) : { schemaVersion: 1, findings: [] };
  const result = await runCollector({ config, output: path.resolve(options.output), adjudications });
  const changes = result.summary.changes;
  const coverage = result.summary.coverage;
  process.stdout.write(`${JSON.stringify({ status: result.summary.status, runId: result.summary.runId, counts: result.summary.counts,
    discovery: result.summary.discovery, extraction: result.summary.extraction, meaningfulChange: result.summary.meaningfulChange,
    checkpoint: result.summary.checkpoint, interval: result.summary.interval,
    changes: changes ? { newFindingCount: changes.newFindingIds.length, changedFindingCount: changes.changedFindingIds.length,
      acceptedAddedCount: changes.acceptedAddedIds.length, acceptedRemovedCount: changes.acceptedRemovedIds.length,
      acceptedAddedIds: changes.acceptedAddedIds.slice(0, 20), acceptedRemovedIds: changes.acceptedRemovedIds.slice(0, 20) } : undefined,
    newAcceptedIds: result.summary.newAcceptedIds?.slice(0, 20),
    coverage: coverage ? { discoveredTotal: coverage.discoveredTotal, everExtracted: coverage.everExtracted,
      deferredMrCount: coverage.deferredMrKeys.length, reviewerAttributionFailureCount: Object.keys(coverage.reviewerAttributionErrors).length,
      sourcePath: result.corpusPath } : undefined, blockers: result.summary.errors,
    summaryPath: result.summaryPath, corpusPath: result.corpusPath, errors: result.summary.errors }, null, 2)}\n`);
  if (result.summary.status !== 'success') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
