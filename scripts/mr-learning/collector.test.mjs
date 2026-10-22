import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { classifyArea, classifyNoteRole, extractFindings, extractReviewNotes, findingId, paginate, reviewerType, runCollector, validateConfig } from './collector.mjs';

const HOST = 'code.example.invalid';
const AUTHOR = { id: 7, username: 'owner', bot: false };
const REVIEWER = { id: 8, username: 'reviewer', bot: false };
const SHA = 'a'.repeat(40);
const FILE = 'frontend/Profile.tsx';
const FINAL_CONTENT = 'if (!user) return null;\nreturn user.name;\n';
const CONFIG = { host: HOST, identity: { id: AUTHOR.id, username: AUTHOR.username }, verifiedHumanUserIds: [8], pageSize: 2, initialSince: '2026-10-11T16:00:00Z' };
const config = validateConfig(CONFIG);
const at = (value = '2026-10-12T09:30:00Z') => () => new Date(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

function mr(iid = 1, overrides = {}) {
  return { id: iid + 100, project_id: 42, iid, author: AUTHOR, state: 'opened', title: `Change ${iid}`,
    web_url: `https://${HOST}/team/project/-/merge_requests/${iid}`, sha: SHA,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-12T08:00:00Z', ...overrides };
}

function finalFile(file = FILE, content = FINAL_CONTENT, revision = SHA) {
  const bytes = Buffer.from(content);
  return { file_path: file, commit_id: revision, ref: revision, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length,
    content_sha256: createHash('sha256').update(bytes).digest('hex'),
    blob_id: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
}

function retention(revision = SHA, file = finalFile()) {
  return { outcome: 'retained', revision, reason: 'The final source still prevents the reported missing-user dereference.',
    files: [{ file: file.file_path, contentSha256: file.content_sha256, blobId: file.blob_id }],
    validation: { status: 'passed', revision, evidence: 'Reviewed the complete final file and checked the missing-user path.' } };
}

function rawFixture(metadata = mr()) {
  const finding = { id: 91, author: clone(REVIEWER), body: 'This dereferences a missing user.', system: false, resolvable: true, resolved: true,
    position: { new_path: 'frontend/Profile.tsx', old_path: 'frontend/Profile.tsx', head_sha: SHA, new_line: 2 },
    created_at: '2026-10-12T06:00:00Z', updated_at: '2026-10-12T06:30:00Z' };
  const reply = { id: 92, author: clone(AUTHOR), body: 'Accepted: I added a missing-user guard.', system: false,
    created_at: '2026-10-12T06:10:00Z', updated_at: '2026-10-12T06:10:00Z' };
  return { schemaVersion: 1, metadata, finalSources: { [`${metadata.project_id}:${metadata.iid}`]: { revision: metadata.sha, files: { [FILE]: finalFile() } } }, retrievedAt: '2026-10-12T09:30:00Z', discussions: [{ id: 'discussion-a', notes: [finding, reply] }],
    notes: [finding, reply], commits: [{ id: SHA }], diffs: [{ new_path: 'frontend/Profile.tsx', old_path: 'frontend/Profile.tsx', diff: '@@ -1 +1,2 @@\n+if (!user) return null;\n return user.name;' }],
    fixCommits: { [SHA]: { belongsToMr: true, metadata: { id: SHA, committed_date: '2026-10-12T06:15:00Z' },
      diffs: [{ new_path: 'frontend/Profile.tsx', old_path: 'frontend/Profile.tsx', diff: '@@ -1 +1,2 @@\n+if (!user) return null;\n return user.name;' }] } } };
}

function adjudication(overrides = {}) {
  return { source: { projectId: 42, mrIid: 1, discussionId: 'discussion-a', noteId: 91 },
    disposition: 'accepted_and_fixed', reason: 'Author agreed and the guard prevents the reported dereference.',
    acceptance: { noteId: 92, quote: 'Accepted: I added a missing-user guard.' }, reviewedThroughNoteId: 92,
    fix: { commitSha: SHA, file: 'frontend/Profile.tsx', addedLines: ['if (!user) return null;'],
      correction: 'Guard the missing-user path before dereferencing user.name.' }, finalRetention: retention(), ...overrides };
}

function mockTransport(fixtures, { fail = null, authenticated = AUTHOR, botProfiles = {} } = {}) {
  const calls = [];
  const transport = async (address) => {
    calls.push(address);
    const url = new URL(address, `https://${HOST}/`);
    const endpoint = url.pathname.slice(1);
    if (fail?.(endpoint)) throw new Error(`mock source unavailable: ${endpoint}`);
    if (endpoint === 'user') return clone(authenticated);
    if (endpoint === `users/${AUTHOR.id}`) return clone(AUTHOR);
    if (/^users\/\d+$/.test(endpoint)) {
      const id = Number(endpoint.split('/').at(-1));
      if (Object.hasOwn(botProfiles, id)) return clone(botProfiles[id]);
      throw new Error('profile inaccessible');
    }
    let values;
    if (endpoint === 'merge_requests') {
      values = fixtures.map((raw) => raw.metadata);
      if (url.searchParams.has('updated_after')) values = values.filter((value) => Date.parse(value.updated_at) >= Date.parse(url.searchParams.get('updated_after')));
      if (url.searchParams.has('updated_before')) values = values.filter((value) => Date.parse(value.updated_at) <= Date.parse(url.searchParams.get('updated_before')));
      if (url.searchParams.has('created_before')) values = values.filter((value) => Date.parse(value.created_at) <= Date.parse(url.searchParams.get('created_before')));
      values = [...values].sort((a, b) => a[url.searchParams.get('order_by')].localeCompare(b[url.searchParams.get('order_by')]));
    } else {
      const matchedMr = /^projects\/(\d+)\/merge_requests\/(\d+)(?:\/(discussions|notes|commits|diffs))?$/.exec(endpoint);
      if (matchedMr) {
        const fixture = fixtures.find((raw) => String(raw.metadata.project_id) === matchedMr[1] && String(raw.metadata.iid) === matchedMr[2]);
        if (!fixture) throw new Error('MR inaccessible');
        if (!matchedMr[3]) return clone(fixture.metadata);
        values = fixture[matchedMr[3]];
      } else {
        const matchedFile = /^projects\/(\d+)\/repository\/files\/(.+)$/.exec(endpoint);
        if (matchedFile) {
          const file = decodeURIComponent(matchedFile[2]);
          const source = fixtures.flatMap((raw) => String(raw.metadata.project_id) === matchedFile[1] ? Object.values(raw.finalSources || {}) : [])
            .find((source) => source.revision === url.searchParams.get('ref') && Object.hasOwn(source.files || {}, file));
          if (!source) throw new Error('final file inaccessible');
          return clone(source.files[file]);
        }
        const matchedCommit = /^projects\/(\d+)\/repository\/commits\/([a-f0-9]+)(?:\/(diff|merge_requests))?$/.exec(endpoint);
        if (!matchedCommit) throw new Error(`unexpected mock request ${address}`);
        const fixture = fixtures.find((raw) => String(raw.metadata.project_id) === matchedCommit[1] && raw.fixCommits?.[matchedCommit[2]]);
        if (!fixture) throw new Error('commit inaccessible');
        const commit = fixture.fixCommits[matchedCommit[2]];
        if (!matchedCommit[3]) return clone(commit.metadata);
        values = matchedCommit[3] === 'diff' ? commit.diffs : (commit.associatedMrs || []);
      }
    }
    assert.ok(url.searchParams.has('page'), 'array requests must include explicit page');
    assert.ok(url.searchParams.has('per_page'), 'array requests must include explicit per_page');
    const page = Number(url.searchParams.get('page'));
    const size = Number(url.searchParams.get('per_page'));
    return clone(values.slice((page - 1) * size, page * size));
  };
  return { transport, calls };
}

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-collector-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('manual page/per_page collection covers all states and projects and records minimal verified identity', async (t) => {
  const output = await temp(t);
  const fixtures = [rawFixture(mr()), rawFixture(mr(2, { state: 'merged', project_id: 99 })), rawFixture(mr(3, { state: 'closed' }))];
  const mock = mockTransport(fixtures);
  const result = await runCollector({ config: CONFIG, output, transport: mock.transport, now: at() });
  assert.equal(result.summary.status, 'success');
  assert.equal(result.summary.discovery.discoveredMrCount, 3);
  assert.equal(result.summary.extraction.extractedMrCount, 3);
  assert.ok(mock.calls.some((url) => url.startsWith('merge_requests?') && url.includes('page=2')));
  assert.ok(mock.calls.every((url) => !url.startsWith('merge_requests?') || (url.includes('scope=all') && url.includes('state=all') && url.includes('author_id=7'))));
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.equal(corpus.mergeRequests.length, 3);
  assert.equal(corpus.findings.length, 3);
  assert.equal(corpus.acceptedGroups.length, 0);
  const identity = JSON.parse(await fs.readFile(path.join(path.dirname(result.summaryPath), 'identity.json')));
  assert.deepEqual(identity.user, { id: 7, username: 'owner' });
});

test('rerunning the same interval yields stable IDs and no duplicate findings or meaningful change', async (t) => {
  const output = await temp(t);
  const mock = mockTransport([rawFixture()]);
  const options = { config: CONFIG, output, transport: mock.transport, now: at(), adjudications: { schemaVersion: 1, findings: [adjudication()] } };
  const first = await runCollector(options);
  const second = await runCollector(options);
  assert.equal(first.summary.counts.acceptedFindings, 1);
  assert.equal(second.summary.counts.acceptedFindings, 1);
  assert.equal(second.summary.meaningfulChange, false);
  assert.deepEqual(second.summary.changes, { newFindingIds: [], changedFindingIds: [], acceptedAddedIds: [], acceptedRemovedIds: [] });
  const corpus = JSON.parse(await fs.readFile(second.corpusPath));
  assert.equal(new Set(corpus.findings.map((f) => f.findingId)).size, 1);
  assert.equal(corpus.findings[0].findingId, findingId(HOST, 42, 1, 'discussion-a', 91));
  const listCall = mock.calls.filter((url) => url.startsWith('merge_requests?')).at(-1);
  assert.ok(listCall.includes('updated_after=2026-10-12T09%3A25%3A00.000Z'));
  assert.ok(listCall.includes('updated_before=2026-10-12T09%3A30%3A00.000Z'));
});

test('resolved-but-pushed-back is excluded and an old closed MR can later be accepted and fixed without updated_at advancing', async (t) => {
  const output = await temp(t);
  const raw = rawFixture(mr(1, { state: 'closed' }));
  raw.discussions[0].notes[1].body = 'I disagree. The invariant guarantees user exists.';
  raw.notes = clone(raw.discussions[0].notes);
  const initial = mockTransport([raw]);
  const pushedBack = adjudication({ disposition: 'pushed_back', reason: 'Author defended the invariant.', evidence: { noteId: 92, quote: 'I disagree.' } });
  const first = await runCollector({ config: CONFIG, output, transport: initial.transport, now: at(), adjudications: { schemaVersion: 1, findings: [pushedBack] } });
  assert.equal(first.summary.counts.acceptedFindings, 0);
  assert.equal(first.summary.counts.dispositions.pushed_back, 1);
  const later = clone(raw);
  later.discussions[0].notes.push({ id: 93, author: AUTHOR, body: 'Accepted after investigating: I added the guard.', created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z' });
  later.notes = clone(later.discussions[0].notes);
  later.fixCommits[SHA].metadata.committed_date = '2026-10-13T08:05:00Z';
  const lateManifest = adjudication({ acceptance: { noteId: 93, quote: 'Accepted after investigating: I added the guard.' }, reviewedThroughNoteId: 93 });
  const mock = mockTransport([later]);
  const second = await runCollector({ config: CONFIG, output, transport: mock.transport, now: at('2026-10-13T09:30:00Z'), adjudications: { schemaVersion: 1, findings: [lateManifest] } });
  assert.equal(second.summary.discovery.discoveredMrCount, 0);
  assert.equal(second.summary.extraction.extractedMrCount, 1);
  assert.equal(second.summary.counts.acceptedFindings, 1);
  assert.equal(second.summary.newAcceptedIds.length, 1);
  assert.ok(mock.calls.includes('projects/42/merge_requests/1'));
});

test('a resolved flag and unverified alleged fix never promote a finding', () => {
  const raw = rawFixture();
  assert.equal(extractFindings(raw, config)[0].disposition, 'uncertain');
  const claimed = adjudication({ fix: { ...adjudication().fix, addedLines: ['user = new User();'] } });
  const findings = extractFindings(raw, config, { findings: [claimed] });
  assert.equal(findings[0].learningEligible, false);
  assert.match(findings[0].reason, /not present/);
});

test('acceptance must cover the latest reply and a post-review commit that belongs to the MR', () => {
  const raw = rawFixture();
  raw.discussions[0].notes.push({ id: 93, author: AUTHOR, body: 'Actually this check breaks the supported flow.', created_at: '2026-10-12T06:20:00Z' });
  const findings = extractFindings(raw, config, { findings: [adjudication()] });
  assert.equal(findings[0].learningEligible, false);
  assert.match(findings[0].reason, /latest author reply/);
  const before = rawFixture();
  before.fixCommits[SHA].metadata.committed_date = '2026-10-12T05:00:00Z';
  assert.match(extractFindings(before, config, { findings: [adjudication()] })[0].reason, /predates/);
  const unrelated = rawFixture();
  unrelated.fixCommits[SHA].belongsToMr = false;
  assert.match(extractFindings(unrelated, config, { findings: [adjudication()] })[0].reason, /belonging/);
  const truncated = rawFixture();
  truncated.fixCommits[SHA].diffs[0].too_large = true;
  assert.match(extractFindings(truncated, config, { findings: [adjudication()] })[0].reason, /truncated/);
});

test('late author reply withdraws previously verified acceptance until it is re-adjudicated', async (t) => {
  const output = await temp(t);
  const first = await runCollector({ config: CONFIG, output, transport: mockTransport([rawFixture()]).transport, now: at(), adjudications: { schemaVersion: 1, findings: [adjudication()] } });
  assert.equal(first.summary.counts.acceptedFindings, 1);
  const raw = rawFixture();
  raw.discussions[0].notes.push({ id: 93, author: AUTHOR, body: 'I reverted this; the original code was intentional.', created_at: '2026-10-13T06:20:00Z' });
  const second = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at('2026-10-13T09:30:00Z'), adjudications: { schemaVersion: 1, findings: [adjudication()] } });
  assert.equal(second.summary.counts.acceptedFindings, 0);
  assert.equal(second.summary.changes.acceptedRemovedIds.length, 1);
});

test('a rebased historical fix requires explicit same-thread author linkage containing the exact full SHA', () => {
  const raw = rawFixture();
  raw.fixCommits[SHA].belongsToMr = false;
  raw.commits = [];
  raw.discussions[0].notes[1].body = `Fixed in \`${SHA}\`.`;
  const entry = adjudication({ acceptance: { noteId: 92, quote: `Fixed in \`${SHA}\`.` },
    fix: { ...adjudication().fix, mrLink: { noteId: 92, quote: `Fixed in \`${SHA}\`.` } } });
  const accepted = extractFindings(raw, config, { findings: [entry] })[0];
  assert.equal(accepted.learningEligible, true);
  assert.equal(accepted.evidence.fix.association.kind, 'author_linked_historical_fix');
  const absent = clone(entry);
  delete absent.fix.mrLink;
  assert.equal(extractFindings(raw, config, { findings: [absent] })[0].learningEligible, false);
  const mismatched = clone(entry);
  mismatched.fix.mrLink.quote = 'Fixed in `' + 'b'.repeat(40) + '`.';
  assert.equal(extractFindings(raw, config, { findings: [mismatched] })[0].learningEligible, false);
  const noSha = clone(entry);
  noSha.fix.mrLink.quote = 'Fixed in';
  assert.equal(extractFindings(raw, config, { findings: [noSha] })[0].learningEligible, false);
  const differentAuthor = clone(raw);
  differentAuthor.discussions[0].notes.push({ id: 93, author: REVIEWER, body: `Fixed in \`${SHA}\`.`, created_at: '2026-10-12T06:20:00Z' });
  const forgedAuthor = clone(entry);
  forgedAuthor.fix.mrLink.noteId = 93;
  assert.equal(extractFindings(differentAuthor, config, { findings: [forgedAuthor] })[0].learningEligible, false);
  const differentThread = clone(raw);
  differentThread.discussions.push({ id: 'unrelated', notes: [{ id: 93, author: AUTHOR, body: `Fixed in \`${SHA}\`.`, created_at: '2026-10-12T06:20:00Z' }] });
  assert.equal(extractFindings(differentThread, config, { findings: [forgedAuthor] })[0].learningEligible, false);
  const absentDiff = clone(raw);
  absentDiff.fixCommits[SHA].diffs = [];
  assert.equal(extractFindings(absentDiff, config, { findings: [entry] })[0].learningEligible, false);
});

function revertFixture() {
  const revertSha = 'b'.repeat(40), file = 'config/flags.json';
  const source = rawFixture(mr(1, { state: 'merged', target_branch: 'main', changes_count: '1' }));
  const request = source.discussions[0].notes[0];
  request.body = 'Please revert this change.'; request.position = { new_path: file, old_path: file };
  source.discussions[0].notes = [request];
  const action = { id: 93, author: clone(AUTHOR), system: true, body: `mentioned in commit ${revertSha}`, created_at: '2026-10-12T06:16:00Z' };
  const link = { id: 94, author: clone(AUTHOR), system: true, body: 'mentioned in merge request !2', created_at: '2026-10-12T06:21:00Z' };
  source.notes = [request, action, link];
  source.diffs = [{ old_path: file, new_path: file, diff: '@@ -1,3 +1,5 @@\n [\n+  "selector-one",\n+  "selector-two",\n   "existing"\n ]' }];
  const patch = { old_path: file, new_path: file, diff: '@@ -1,5 +1,3 @@\n [\n-  "selector-one",\n-  "selector-two",\n   "existing"\n ]' };
  const revert = rawFixture(mr(2, { state: 'merged', target_branch: 'main', changes_count: '1', created_at: '2026-10-12T06:20:00Z', merged_at: '2026-10-12T06:40:00Z', merge_user: { id: 20, username: 'merge-service' } }));
  revert.discussions = []; revert.notes = []; revert.commits = [{ id: revertSha }, { id: 'c'.repeat(40) }]; revert.diffs = [clone(patch)];
  const commit = { metadata: { id: revertSha, message: 'Revert "Register selectors"\n\nThis reverts merge request !1', committed_date: '2026-10-12T06:15:00Z', stats: { additions: 0, deletions: 2, total: 2 } }, diffs: [clone(patch)], belongsToMr: false, associatedMrs: [clone(revert.metadata)] };
  source.fixCommits = { [revertSha]: commit }; revert.fixCommits = { [revertSha]: clone(commit) };
  source.revertMrs = { '42:2': { metadata: clone(revert.metadata), commits: clone(revert.commits), diffs: clone(revert.diffs) } };
  const finalSource = finalFile(file, '[\n  \"existing\"\n]\n');
  source.finalSources['42:2'] = { revision: revert.metadata.sha, files: { [file]: finalSource } };
  revert.finalSources = { '42:2': clone(source.finalSources['42:2']) };
  const entry = adjudication({ finalRetention: retention(revert.metadata.sha, finalSource), reason: 'The author reverted the requested change through the linked merged corrective MR.',
    acceptance: { kind: 'author_owned_revert', action: { noteId: 93, quote: action.body }, mrLink: { noteId: 94, quote: link.body }, revertMr: { projectId: 42, mrIid: 2 } }, reviewedThroughNoteId: null,
    fix: { commitSha: revertSha, file, addedLines: [], removedLines: ['  "selector-one",', '  "selector-two",'], correction: 'Remove the exact two selectors introduced by the source change.' } });
  return { source, revert, entry, revertSha };
}

test('explicit author-owned merged revert verifies action without inventing a reply; legacy reply path remains unchanged', () => {
  const { source, entry } = revertFixture();
  const accepted = extractFindings(source, config, { findings: [entry] })[0];
  assert.equal(accepted.learningEligible, true); assert.equal(accepted.evidence.acceptance.kind, 'author_owned_revert');
  assert.equal(accepted.evidence.reviewedThroughNoteId, null); assert.equal(accepted.evidence.acceptance.action.noteId, 93);
  assert.equal(accepted.evidence.fix.association.kind, 'author_owned_revert_mr');
  const noMode = clone(entry); delete noMode.acceptance.kind;
  assert.match(extractFindings(source, config, { findings: [noMode] })[0].reason, /quoted author reply/);
  assert.equal(extractFindings(rawFixture(), config, { findings: [adjudication()] })[0].learningEligible, true);
});

test('author-owned revert rejects generic/wrong links, unmerged ownership/target mismatches, incomplete reversals and stale author coverage', () => {
  const invalid = [
    ['missing action', (raw, entry) => { delete entry.acceptance.action; }],
    ['nonsystem action', (raw) => { raw.notes[1].system = false; }],
    ['other action author', (raw) => { raw.notes[1].author = REVIEWER; }],
    ['generic commit mention', (raw, entry) => { raw.notes[1].body = entry.acceptance.action.quote = 'The commit looks relevant'; }],
    ['wrong action SHA', (raw, entry) => { raw.notes[1].body = entry.acceptance.action.quote = 'mentioned in commit ' + 'd'.repeat(40); }],
    ['wrong MR mention', (raw, entry) => { raw.notes[2].body = entry.acceptance.mrLink.quote = 'mentioned in merge request !20'; }],
    ['other source MR event', (raw) => { raw.notes = raw.notes.filter((note) => note.id !== 94); }],
    ['other project', (raw, entry) => { entry.acceptance.revertMr.projectId = 99; }],
    ['same source MR', (raw, entry) => { entry.acceptance.revertMr.mrIid = 1; }],
    ['unmerged source', (raw) => { raw.metadata.state = 'opened'; }],
    ['unmerged', (raw) => { raw.revertMrs['42:2'].metadata.state = 'closed'; }],
    ['other revert author', (raw) => { raw.revertMrs['42:2'].metadata.author = REVIEWER; }],
    ['other target', (raw) => { raw.revertMrs['42:2'].metadata.target_branch = 'release'; }],
    ['unrelated commit', (raw, entry) => { raw.revertMrs['42:2'].commits = []; raw.fixCommits[entry.fix.commitSha].associatedMrs = [mr(3)]; }],
    ['generic commit message', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].metadata.message = 'Mention !1 in discussion'; }],
    ['wrong source commit message', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].metadata.message = 'This reverts merge request !10'; }],
    ['pre-request action', (raw) => { raw.notes[1].created_at = '2026-10-12T05:00:00Z'; }],
    ['undated action', (raw) => { delete raw.notes[1].created_at; }],
    ['pre-request commit', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].metadata.committed_date = '2026-10-12T05:00:00Z'; }],
    ['invalid merge chronology', (raw) => { raw.revertMrs['42:2'].metadata.merged_at = '2026-10-12T06:10:00Z'; }],
    ['multi-file source', (raw) => { raw.diffs.push(clone(raw.diffs[0])); raw.metadata.changes_count = '2'; }],
    ['unknown source coverage', (raw) => { raw.metadata.changes_count = '1+'; }],
    ['multi-file revert', (raw) => { raw.revertMrs['42:2'].diffs.push(clone(raw.revertMrs['42:2'].diffs[0])); }],
    ['incomplete hunk', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].diffs[0].diff = '@@ -1,5 +1,3 @@\n-  "selector-one",'; }],
    ['wrong context', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].diffs[0].diff = raw.fixCommits[entry.fix.commitSha].diffs[0].diff.replace('"existing"', '"elsewhere"'); }],
    ['wrong hunk position', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].diffs[0].diff = raw.fixCommits[entry.fix.commitSha].diffs[0].diff.replace('@@ -1,5 +1,3 @@', '@@ -4,5 +4,3 @@'); }],
    ['partial claimed correction', (raw, entry) => { entry.fix.removedLines.pop(); }],
    ['truncated source', (raw) => { raw.diffs[0].too_large = true; }],
    ['truncated correction', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].diffs[0].collapsed = true; }],
    ['wrong commit statistics', (raw, entry) => { raw.fixCommits[entry.fix.commitSha].metadata.stats.total = 3; }],
    ['missing coverage marker', (raw, entry) => { delete entry.reviewedThroughNoteId; }],
    ['stale later source-author reply', (raw) => { raw.notes.push({ id: 99, author: AUTHOR, system: false, body: 'The correction needs another look.', created_at: '2026-10-12T07:00:00Z' }); }],
  ];
  for (const [label, mutate] of invalid) {
    const { source, entry } = revertFixture(); mutate(source, entry);
    const result = extractFindings(source, config, { findings: [entry] })[0];
    assert.equal(result.learningEligible, false, label); assert.equal(result.disposition, 'uncertain', label);
  }
  const { source, entry, revertSha } = revertFixture();
  source.revertMrs['42:2'].commits = [];
  assert.equal(extractFindings(source, config, { findings: [entry] })[0].learningEligible, true, 'verified commit API association is allowed');
  source.fixCommits[revertSha].associatedMrs = [];
  assert.equal(extractFindings(source, config, { findings: [entry] })[0].learningEligible, false);
});

test('related revert ingestion paginates and retains raw provenance, is idempotent, and does not count a companion withdrawal twice', async (t) => {
  const output = await temp(t); const { source, revert, entry } = revertFixture();
  const companion = rawFixture(mr(3, { state: 'closed' }));
  companion.discussions[0].notes[1].body = 'Withdrawn: this work belongs elsewhere.'; companion.notes = clone(companion.discussions[0].notes);
  const withdrawn = adjudication({ source: { projectId: 42, mrIid: 3, discussionId: 'discussion-a', noteId: 91 }, disposition: 'withdrawn', reason: 'Author withdrew the unmerged companion work.', evidence: { noteId: 92, quote: 'Withdrawn: this work belongs elsewhere.' } });
  const mock = mockTransport([source, revert, companion]); const options = { config: CONFIG, output, transport: mock.transport, now: at(), adjudications: { schemaVersion: 1, findings: [entry, withdrawn] } };
  const first = await runCollector(options); assert.equal(first.summary.status, 'success'); assert.equal(first.summary.counts.acceptedFindings, 1); assert.equal(first.summary.counts.dispositions.withdrawn, 1);
  assert.ok(mock.calls.some((address) => address.startsWith('projects/42/merge_requests/2/commits?') && address.includes('page=2')));
  const retained = JSON.parse(await fs.readFile(path.join(path.dirname(first.summaryPath), 'raw', '42-1.json')));
  assert.equal(retained.revertMrs['42:2'].metadata.state, 'merged'); assert.equal(retained.revertMrs['42:2'].commits.length, 2); assert.equal(retained.revertMrs['42:2'].diffs.length, 1);
  const second = await runCollector(options); assert.equal(second.summary.status, 'success'); assert.equal(second.summary.counts.acceptedFindings, 1); assert.equal(second.summary.meaningfulChange, false); assert.deepEqual(second.summary.newAcceptedIds, []);
});

test('related revert metadata/commit/diff failures never advance or empty the last successful checkpoint', async (t) => {
  const output = await temp(t); const { source, revert, entry } = revertFixture(); const fixtures = [source, revert];
  const baseline = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures).transport, now: at() });
  assert.equal(baseline.summary.status, 'success'); const stateBefore = await fs.readFile(path.join(output, 'state.json'), 'utf8');
  for (const suffix of ['', '/commits', '/diffs']) {
    const failed = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures, { fail: (endpoint) => endpoint === `projects/42/merge_requests/2${suffix}` }).transport,
      now: at('2026-10-13T09:30:00Z'), adjudications: { schemaVersion: 1, findings: [entry] } });
    assert.equal(failed.summary.status, 'failed'); assert.equal(failed.summary.checkpointAdvanced, false); assert.equal(await fs.readFile(path.join(output, 'state.json'), 'utf8'), stateBefore);
  }
  const retry = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures).transport, now: at('2026-10-13T09:30:00Z'), adjudications: { schemaVersion: 1, findings: [entry] } });
  assert.equal(retry.summary.status, 'success'); assert.equal(retry.summary.counts.acceptedFindings, 1);
});

test('verified automation introductions and pure good-job/no-diff notes are context, while substantive controls remain candidates', () => {
  const automation = { id: 10, username: 'review-automation', bot: true };
  const intro = { id: 100, author: automation, created_at: '2026-10-12T06:00:00Z', body: "<!-- Reviewer's intro comment indicator -->\nHi, I'm the review helper. I can help review this MR, answer questions, and address review feedback." };
  const noIssues = { ...intro, id: 101, body: "<!-- Reviewer's good job indicator -->\nThis MR was reviewed by ReviewHelper and no issues were found. Great job! 🏅" };
  const unchanged = { ...intro, id: 102, body: "<!-- Reviewer's no diff indicator -->\n👀 No new changes since my last review. The code is the same as before." };
  assert.equal(classifyNoteRole(intro, { notes: [intro] }, config).candidateStatus, 'context_only');
  assert.equal(classifyNoteRole(noIssues, { notes: [noIssues] }, config).candidateStatus, 'context_only');
  assert.equal(classifyNoteRole(unchanged, { notes: [unchanged] }, config).candidateStatus, 'context_only');
  const unknown = { ...intro, author: { id: 11, username: 'unknown' } };
  assert.equal(classifyNoteRole(unknown, { notes: [unknown] }, config).candidateStatus, 'needs_adjudication');
  const appendedIssue = { ...noIssues, body: `${noIssues.body}\nHowever, user.name still throws on the anonymous path.` };
  assert.equal(classifyNoteRole(appendedIssue, { notes: [appendedIssue] }, config).candidateStatus, 'needs_adjudication');
  const substantiveIntro = { ...intro, body: `${intro.body}\nBug: user.name crashes on anonymous requests.` };
  assert.equal(classifyNoteRole(substantiveIntro, { notes: [substantiveIntro] }, config).candidateStatus, 'needs_adjudication');
  const raw = rawFixture();
  raw.discussions.push({ id: 'intro', notes: [intro] }, { id: 'good-job', notes: [noIssues] }, { id: 'no-diff', notes: [unchanged] });
  assert.equal(extractReviewNotes(raw, config).length, 4);
  assert.equal(extractFindings(raw, config).length, 1);
});

test('confirmation detail is labelled conservatively, and explicit quoted context adjudication can separate it', () => {
  const raw = rawFixture();
  const confirmation = { id: 93, author: REVIEWER, body: 'Confirmed — the guard is before URL construction and both values are checked.', created_at: '2026-10-12T06:20:00Z' };
  raw.discussions[0].notes.push(confirmation);
  const observations = extractReviewNotes(raw, config);
  assert.equal(observations.find((f) => f.noteId === 93).noteRole, 'confirmation_followup');
  assert.equal(observations.find((f) => f.noteId === 93).candidateStatus, 'needs_adjudication');
  const manifest = { findings: [], nonFindingNotes: [{ source: { projectId: 42, mrIid: 1, discussionId: 'discussion-a', noteId: 93 },
    reason: 'Reviewer confirms the earlier corrected defect without a new request.', noteRole: 'confirmation_followup', evidence: { noteId: 93, quote: confirmation.body } }] };
  assert.equal(extractFindings(raw, config, manifest).length, 1);
  assert.equal(extractReviewNotes(raw, config, manifest).find((f) => f.noteId === 93).candidateStatus, 'context_only');
  const invalid = clone(manifest);
  invalid.nonFindingNotes[0].evidence.quote = 'Invented confirmation';
  assert.throws(() => extractReviewNotes(raw, config, invalid), /Invalid context-only/);
});

test('an MR with only an automation introduction is not reported as having review candidates', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  const intro = { id: 100, author: { id: 10, username: 'automation', bot: true }, created_at: '2026-10-12T06:00:00Z',
    body: "<!-- Reviewer's intro comment indicator -->\nHi, I'm a helper. Add the review label when ready." };
  raw.discussions = [{ id: 'intro', notes: [intro] }];
  raw.notes = [intro];
  const result = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at() });
  assert.equal(result.summary.counts.observedExternalNotes, 1);
  assert.equal(result.summary.counts.contextOnlyNotes, 1);
  assert.equal(result.summary.counts.findingCandidates, 0);
  assert.equal(result.summary.counts.reviewCandidateMrCount, 0);
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.equal(corpus.findings.length, 0);
  assert.equal(corpus.nonFindingNotes[0].noteId, 100);
});

test('new context classification replaces old candidate records, while missing original notes remain uncertain with archived provenance', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  const original = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at(), adjudications: { schemaVersion: 1, findings: [adjudication()] } });
  assert.equal(original.summary.counts.acceptedFindings, 1);
  const current = clone(raw);
  current.discussions = [];
  current.notes = [];
  const missing = await runCollector({ config: CONFIG, output, transport: mockTransport([current]).transport, now: at('2026-10-13T09:30:00Z') });
  const corpus = JSON.parse(await fs.readFile(missing.corpusPath));
  assert.equal(corpus.findings.length, 1);
  assert.equal(corpus.findings[0].sourceMissing, true);
  assert.equal(corpus.findings[0].disposition, 'uncertain');
  assert.equal(corpus.findings[0].learningEligible, false);
  assert.ok(corpus.findings[0].archivedSourcePath.endsWith('42-1.json'));
  const repeated = await runCollector({ config: CONFIG, output, transport: mockTransport([current]).transport, now: at('2026-10-14T09:30:00Z') });
  assert.equal(repeated.summary.meaningfulChange, false);
  const resurrected = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at('2026-10-15T09:30:00Z'),
    adjudications: { schemaVersion: 1, findings: [], nonFindingNotes: [{ source: { projectId: 42, mrIid: 1, discussionId: 'discussion-a', noteId: 91 },
      reason: 'Explicitly adjudicated nonfinding for migration verification.', evidence: { noteId: 91, quote: raw.discussions[0].notes[0].body } }] } });
  const finalCorpus = JSON.parse(await fs.readFile(resurrected.corpusPath));
  assert.equal(finalCorpus.findings.length, 0);
  assert.equal(finalCorpus.nonFindingNotes.length, 1);
  assert.equal(resurrected.summary.counts.findingCandidates, 0);
});

test('initial window includes older open MRs and clearly defers old closed history', async (t) => {
  const output = await temp(t);
  const fixtures = [rawFixture(mr(1, { updated_at: '2026-06-01T00:00:00Z' })), rawFixture(mr(2, { updated_at: '2026-06-01T00:00:00Z', state: 'merged' }))];
  const result = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures).transport, now: at() });
  assert.equal(result.summary.discovery.discoveredMrCount, 2);
  assert.equal(result.summary.extraction.extractedMrCount, 1);
  assert.deepEqual(result.summary.coverage.deferredMrKeys, ['42:2']);
  const next = await runCollector({ config: { ...CONFIG, revisitMrKeys: ['42:2'] }, output, transport: mockTransport(fixtures).transport, now: at('2026-10-13T09:30:00Z') });
  assert.equal(next.summary.extraction.extractedMrCount, 2);
  assert.equal(next.summary.coverage.deferredMrKeys.length, 0);
});

test('a partial extraction failure preserves successful metadata discovery and does not advance or empty previous state', async (t) => {
  const output = await temp(t);
  const fixtures = [rawFixture(), rawFixture(mr(2))];
  const first = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures).transport, now: at() });
  const stateBefore = await fs.readFile(first.statePath, 'utf8');
  const mock = mockTransport(fixtures, { fail: (endpoint) => endpoint === 'projects/42/merge_requests/2/discussions' });
  const failed = await runCollector({ config: CONFIG, output, transport: mock.transport, now: at('2026-10-13T09:30:00Z') });
  assert.equal(failed.summary.status, 'failed');
  assert.equal(failed.summary.discovery.status, 'success');
  assert.equal(failed.summary.extraction.extractedMrCount, 1);
  assert.equal(failed.summary.checkpointAdvanced, false);
  assert.equal(await fs.readFile(first.statePath, 'utf8'), stateBefore);
  const discovery = JSON.parse(await fs.readFile(path.join(path.dirname(failed.summaryPath), 'source-discovery.json')));
  assert.equal(discovery.coverage.status, 'success');
  const state = JSON.parse(stateBefore);
  const corpus = JSON.parse(await fs.readFile(path.join(output, state.corpusPath)));
  assert.equal(corpus.findings.length, 2);
  const retry = await runCollector({ config: CONFIG, output, transport: mockTransport(fixtures).transport, now: at('2026-10-13T09:30:00Z') });
  assert.equal(retry.summary.status, 'success');
  assert.equal(retry.summary.counts.findingCandidates, 2);
});

test('initial source failure leaves no successful checkpoint and reports a failed day', async (t) => {
  const output = await temp(t);
  const mock = mockTransport([rawFixture()], { fail: (endpoint) => endpoint === 'merge_requests' });
  const result = await runCollector({ config: CONFIG, output, transport: mock.transport, now: at() });
  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.discovery.status, 'failed');
  await assert.rejects(fs.access(result.statePath), { code: 'ENOENT' });
  assert.ok(result.summary.errors.length);
});

test('wrong identity fails before listing; missing prior corpus is a failure rather than deletion', async (t) => {
  const output = await temp(t);
  const wrong = mockTransport([rawFixture()], { authenticated: { id: 9, username: 'other' } });
  const denied = await runCollector({ config: CONFIG, output, transport: wrong.transport, now: at() });
  assert.equal(denied.summary.status, 'failed');
  assert.equal(wrong.calls.some((url) => url.startsWith('merge_requests')), false);
  const good = await runCollector({ config: CONFIG, output, transport: mockTransport([rawFixture()]).transport, now: at() });
  await fs.rm(good.corpusPath);
  const failed = await runCollector({ config: CONFIG, output, transport: mockTransport([rawFixture()]).transport, now: at() });
  assert.equal(failed.summary.status, 'failed');
  assert.match(failed.summary.errors[0].message, /corpus is missing/);
});

test('reviewer attribution requires API bot evidence or explicit stable IDs; writing style does not count', () => {
  assert.equal(reviewerType({ id: 11, username: 'robot-looking-name' }, config).type, 'unknown');
  assert.equal(reviewerType({ id: 11, bot: true }, config).type, 'service');
  assert.equal(reviewerType({ id: 11 }, { verifiedAiUserIds: [11] }).type, 'ai');
  assert.equal(reviewerType({ id: 11 }, config, { id: 11, bot: false }).type, 'unknown');
  assert.equal(reviewerType({ id: 11 }, { verifiedHumanUserIds: [11] }).type, 'human');
  assert.equal(reviewerType({ id: 11 }, { verifiedServiceUserIds: [11] }).type, 'service');
});

test('unknown attribution and incomplete current diff coverage are retained explicitly', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  delete raw.discussions[0].notes[0].author.bot;
  delete raw.notes[0].author.bot;
  raw.discussions[0].notes[0].author.id = 11;
  raw.notes[0].author.id = 11;
  raw.diffs[0].too_large = true;
  const result = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at() });
  assert.equal(result.summary.status, 'success');
  assert.equal(result.summary.counts.reviewerTypes.unknown, 1);
  assert.equal(result.summary.warnings.length, 1);
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.deepEqual(corpus.mergeRequests[0].currentDiffLimitations, ['frontend/Profile.tsx']);
});

test('manual finding splits preserve IDs and duplicate defects retain reviewer contributors without double counting', () => {
  const raw = rawFixture();
  const second = clone(raw.discussions[0].notes[0]);
  second.id = 94;
  second.author = { id: 10, username: 'another-reviewer', bot: true };
  raw.discussions[0].notes.push(second);
  const canonical = findingId(HOST, 42, 1, 'discussion-a', 91);
  const entries = [adjudication({ canonicalFindingId: canonical }), adjudication({ source: { projectId: 42, mrIid: 1, discussionId: 'discussion-a', noteId: 94 },
    disposition: 'duplicate', duplicateOf: canonical, reason: 'The same dereference defect was already reported.' })];
  const findings = extractFindings(raw, config, { findings: entries });
  assert.equal(findings.length, 2);
  assert.equal(findings.filter((f) => f.learningEligible).length, 1);
  assert.equal(findings[1].reviewer.type, 'service');
  const split = extractFindings(rawFixture(), config, { findings: [adjudication({ findingKey: 'missing-user' }), adjudication({ findingKey: 'name-scope', disposition: 'uncertain', evidence: { noteId: 91, quote: 'missing user' } })] });
  assert.equal(split.length, 2);
  assert.equal(new Set(split.map((f) => f.findingId)).size, 2);
});

test('file classification is conservative and includes build/config changes', () => {
  assert.equal(classifyArea('frontend/Profile.tsx'), 'frontend');
  assert.equal(classifyArea('api/user.ts'), 'backend');
  assert.equal(classifyArea('lib/data.ts'), 'other');
  assert.equal(classifyArea(null), 'other');
  assert.equal(classifyArea('.gitlab-ci.yml'), 'CI/build');
  assert.equal(classifyArea('.github/workflows/ci.yml'), 'CI/build');
  assert.equal(classifyArea('pnpm-lock.yaml'), 'CI/build');
});

test('an accepted defect counts once and service duplicates stay outside learning contributors', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  const second = clone(raw.discussions[0].notes[0]);
  second.id = 94;
  second.author = { id: 10, username: 'automation', bot: true };
  raw.discussions[0].notes.push(second);
  const canonical = findingId(HOST, 42, 1, 'discussion-a', 91);
  const entries = [adjudication(), { source: { projectId: 42, mrIid: 1, discussionId: 'discussion-a', noteId: 94 },
    disposition: 'duplicate', duplicateOf: canonical, reason: 'Same defect, second reviewer.' }];
  const result = await runCollector({ config: CONFIG, output, transport: mockTransport([raw]).transport, now: at(), adjudications: { schemaVersion: 1, findings: entries } });
  assert.equal(result.summary.counts.acceptedFindings, 1);
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.equal(corpus.acceptedGroups[0].memberFindingIds.length, 1);
  assert.deepEqual(corpus.acceptedGroups[0].contributors.map((r) => r.type), ['human']);
});

test('repeated pages and invalid array responses cannot become successful coverage', async () => {
  await assert.rejects(paginate(async () => [{ id: 1 }, { id: 2 }], 'merge_requests', {}, { pageSize: 2 }), /Repeated page/);
  await assert.rejects(paginate(async () => ({ error: 'denied' }), 'merge_requests'), /Expected an array/);
});

test('old accepted corrections are withdrawn on a changed head without a new author reply or updated_at', async (t) => {
  const output = await temp(t);
  const raw = rawFixture(mr(1, { state: 'merged' }));
  const options = { config: CONFIG, output, now: at(), adjudications: { schemaVersion: 1, findings: [adjudication()] } };
  const first = await runCollector({ ...options, transport: mockTransport([raw]).transport });
  assert.equal(first.summary.counts.acceptedFindings, 1);
  const later = clone(raw);
  later.metadata.sha = 'b'.repeat(40);
  later.finalSources['42:1'] = { revision: later.metadata.sha, files: { [FILE]: finalFile(FILE, 'return user.name;\n', later.metadata.sha) } };
  assert.deepEqual(later.discussions, raw.discussions, 'there is no new author reply');
  assert.equal(later.metadata.updated_at, raw.metadata.updated_at);
  const second = await runCollector({ ...options, now: at('2026-10-13T09:30:00Z'), transport: mockTransport([later]).transport });
  assert.equal(second.summary.discovery.discoveredMrCount, 0);
  assert.equal(second.summary.extraction.extractedMrCount, 1);
  assert.equal(second.summary.counts.acceptedFindings, 0);
  assert.equal(second.summary.changes.acceptedRemovedIds.length, 1);
  const corpus = JSON.parse(await fs.readFile(second.corpusPath));
  assert.match(corpus.findings[0].reason, /revision changed/);
  const removed = adjudication({ finalRetention: { ...retention(later.metadata.sha, later.finalSources['42:1'].files[FILE]), outcome: 'removed', reason: 'The later head removed the guard.' } });
  assert.equal(extractFindings(later, config, { findings: [removed] })[0].learningEligible, false);
});

test('fresh final semantic proof accepts a refactor that preserves the remedy without the original literal fix line', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  const revision = 'b'.repeat(40);
  const file = finalFile(FILE, 'return user?.name ?? null;\n', revision);
  raw.metadata.sha = revision;
  raw.finalSources['42:1'] = { revision, files: { [FILE]: file } };
  const proof = retention(revision, file);
  proof.reason = 'Optional chaining now preserves the missing-user guard after the semantic refactor.';
  const entry = adjudication({ finalRetention: proof });
  const mock = mockTransport([raw]);
  const result = await runCollector({ config: CONFIG, output, now: at(), transport: mock.transport, adjudications: { schemaVersion: 1, findings: [entry] } });
  assert.equal(result.summary.counts.acceptedFindings, 1);
  assert.equal(Buffer.from(file.content, 'base64').toString().includes(entry.fix.addedLines[0]), false);
  assert.ok(mock.calls.includes(`projects/42/repository/files/frontend%2FProfile.tsx?ref=${revision}`));
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.equal(corpus.findings[0].evidence.retention.revision, revision);
  assert.equal(corpus.findings[0].evidence.retention.reason, proof.reason);
});

test('retention is per remedy: a reverted sibling cannot inherit the retained sibling proof', () => {
  const raw = rawFixture();
  const entries = [adjudication({ findingKey: 'retained' }), adjudication({ findingKey: 'reverted', finalRetention: {
    ...retention(), outcome: 'reverted', reason: 'This second remedy was reverted in the final source.' } })];
  const findings = extractFindings(raw, config, { findings: entries });
  assert.equal(findings.length, 2);
  assert.equal(findings.find((finding) => finding.findingId.endsWith(':retained')).learningEligible, true);
  assert.equal(findings.find((finding) => finding.findingId.endsWith(':reverted')).learningEligible, false);
});

test('missing, incomplete, stale, malformed or mismatched final file proof fails closed', () => {
  const invalid = [
    ['no semantic proof', (raw, entry) => { delete entry.finalRetention; }],
    ['unknown semantics', (raw, entry) => { entry.finalRetention.outcome = 'unknown'; }],
    ['no semantic reason', (raw, entry) => { entry.finalRetention.reason = ' '; }],
    ['absent source', (raw) => { delete raw.finalSources; }],
    ['absent file', (raw) => { delete raw.finalSources['42:1'].files[FILE]; }],
    ['file API failure', (raw) => { raw.finalSources['42:1'].files[FILE] = { error: 'unavailable' }; }],
    ['truncated file', (raw) => { raw.finalSources['42:1'].files[FILE].truncated = true; }],
    ['collapsed file', (raw) => { raw.finalSources['42:1'].files[FILE].collapsed = true; }],
    ['oversized file', (raw) => { raw.finalSources['42:1'].files[FILE].too_large = true; }],
    ['partial content', (raw) => { raw.finalSources['42:1'].files[FILE].content = Buffer.from('return user.name;').toString('base64'); }],
    ['content hash mismatch', (raw, entry) => { entry.finalRetention.files[0].contentSha256 = '0'.repeat(64); }],
    ['blob hash mismatch', (raw, entry) => { entry.finalRetention.files[0].blobId = raw.finalSources['42:1'].files[FILE].blob_id = '0'.repeat(40); }],
    ['API content hash mismatch', (raw) => { raw.finalSources['42:1'].files[FILE].content_sha256 = '0'.repeat(64); }],
    ['missing file size', (raw) => { delete raw.finalSources['42:1'].files[FILE].size; }],
    ['wrong path', (raw) => { raw.finalSources['42:1'].files[FILE].file_path = 'unrelated.ts'; }],
    ['wrong response revision', (raw) => { raw.finalSources['42:1'].files[FILE].commit_id = 'b'.repeat(40); }],
    ['wrong requested ref', (raw) => { raw.finalSources['42:1'].files[FILE].ref = 'main'; }],
    ['wrong encoding', (raw) => { raw.finalSources['42:1'].files[FILE].encoding = 'text'; }],
    ['invalid base64', (raw) => { raw.finalSources['42:1'].files[FILE].content += '!'; }],
    ['missing validation', (raw, entry) => { delete entry.finalRetention.validation; }],
    ['failed validation', (raw, entry) => { entry.finalRetention.validation.status = 'failed'; }],
    ['stale validation revision', (raw, entry) => { entry.finalRetention.validation.revision = 'b'.repeat(40); }],
    ['moving source', (raw) => { raw.finalSources['42:1'].changedDuringCollection = true; }],
  ];
  for (const [label, mutate] of invalid) {
    const raw = rawFixture(), entry = adjudication();
    mutate(raw, entry);
    const finding = extractFindings(raw, config, { findings: [entry] })[0];
    assert.equal(finding.learningEligible, false, label);
    assert.equal(finding.evidenceVerified, false, label);
    assert.equal(finding.disposition, 'uncertain', label);
  }
});

test('a head moving during final file collection cannot certify the old revision', async (t) => {
  const output = await temp(t);
  const raw = rawFixture();
  const mock = mockTransport([raw]);
  const transport = async (address) => {
    const result = await mock.transport(address);
    if (address.startsWith('projects/42/repository/files/')) raw.metadata.sha = 'b'.repeat(40);
    return result;
  };
  const result = await runCollector({ config: CONFIG, output, transport, now: at(), adjudications: { schemaVersion: 1, findings: [adjudication()] } });
  assert.equal(result.summary.status, 'success');
  assert.equal(result.summary.counts.acceptedFindings, 0);
  const retained = JSON.parse(await fs.readFile(path.join(path.dirname(result.summaryPath), 'raw', '42-1.json')));
  assert.equal(retained.finalSources['42:1'].revision, SHA);
  assert.equal(retained.finalSources['42:1'].changedDuringCollection, true);
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.match(corpus.findings[0].reason, /revision changed/);
});

test('verified human groups precede configured verified secondary AI and a shared canonical defect counts once', async (t) => {
  const output = await temp(t);
  const ai = { id: 10, username: 'review-assistant', bot: true };
  const aiRaw = rawFixture();
  aiRaw.discussions[0].notes[0].author = clone(ai);
  aiRaw.notes = clone(aiRaw.discussions[0].notes);
  const humanRaw = rawFixture(mr(2));
  const duplicate = clone(humanRaw.discussions[0].notes[0]);
  duplicate.id = 94;
  duplicate.author = clone(ai);
  humanRaw.discussions[0].notes.push(duplicate);
  humanRaw.notes = clone(humanRaw.discussions[0].notes);
  const canonical = findingId(HOST, 42, 2, 'discussion-a', 91);
  const entries = [adjudication(), adjudication({ source: { projectId: 42, mrIid: 2, discussionId: 'discussion-a', noteId: 91 } }), {
    source: { projectId: 42, mrIid: 2, discussionId: 'discussion-a', noteId: 94 }, disposition: 'duplicate', duplicateOf: canonical, reason: 'The AI and human identify the same missing-user dereference.' }];
  const selectedConfig = { ...CONFIG, verifiedAiUserIds: [10], learningSecondaryAiUserIds: [10] };
  assert.throws(() => validateConfig({ ...selectedConfig, learningSecondaryAiUserIds: [10, 11] }), /verified AI/, 'unverified secondary IDs are rejected');
  const result = await runCollector({ config: selectedConfig, output, transport: mockTransport([aiRaw, humanRaw]).transport, now: at(), adjudications: { schemaVersion: 1, findings: entries } });
  assert.equal(result.summary.counts.acceptedFindings, 2);
  const corpus = JSON.parse(await fs.readFile(result.corpusPath));
  assert.equal(corpus.acceptedGroups[0].findingId, canonical, 'human-first ordering beats lexical AI finding order');
  assert.deepEqual(corpus.acceptedGroups[0].contributors.map((reviewer) => reviewer.type), ['human', 'ai']);
  assert.equal(corpus.acceptedGroups[0].memberFindingIds.length, 2);
  assert.deepEqual(corpus.acceptedGroups[1].contributors.map((reviewer) => reviewer.type), ['ai']);
  assert.equal(corpus.findings.find((finding) => finding.mrIid === 1).learningCohort, 'secondary_ai');
  const unselectedAi = extractFindings(aiRaw, validateConfig({ ...CONFIG, verifiedAiUserIds: [10] }), { findings: [adjudication()] })[0];
  assert.equal(unselectedAi.reviewer.type, 'ai');
  assert.equal(unselectedAi.evidenceVerified, true);
  assert.equal(unselectedAi.learningEligible, false, 'verified AI requires explicit secondary learning selection');
});

test('service, unknown and source-author accounts cannot contribute positive learning', () => {
  for (const [type, author] of [['service', { id: 10, username: 'service', bot: true }], ['unknown', { id: 11, username: 'unverified' }]]) {
    const raw = rawFixture();
    raw.discussions[0].notes[0].author = author;
    raw.notes = clone(raw.discussions[0].notes);
    const finding = extractFindings(raw, config, { findings: [adjudication()] })[0];
    assert.equal(finding.reviewer.type, type);
    assert.equal(finding.disposition, 'accepted_and_fixed');
    assert.equal(finding.evidenceVerified, true);
    assert.equal(finding.learningCohort, null);
    assert.equal(finding.learningEligible, false);
  }
  const raw = rawFixture();
  raw.discussions[0].notes[0].author = clone(AUTHOR);
  raw.notes = clone(raw.discussions[0].notes);
  assert.deepEqual(extractFindings(raw, validateConfig({ ...CONFIG, verifiedHumanUserIds: [7, 8] }), { findings: [adjudication()] }), []);
});
