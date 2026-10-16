import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchFindings, validateSuite, validateThresholds, validatePromotionEvidence, evaluationBindingHash, evaluationResultsHash } from './lib.js';
import { promotionFixture } from './fixtures/promotion-fixture.js';

const expected = [{ruleId:'r',file:'a.js',lineStart:1,lineEnd:1,defect:'Nullable access throws',scope:'Nullable caller input',remedy:'Guard the input'}];
const finding = message => ({ruleId:'r',file:'a.js',line:1,message});
const judgment = values => ({actualIndex:0,expectedIndex:0,defect:true,scope:true,remedy:true,reason:'The explanation identifies the null dereference and a guard in the nullable path.',...values});

test('correct IDs and locations never earn credit without semantic adjudication', () => {
  const wrong = [finding('There is no defect; change indentation.')];
  assert.equal(matchFindings(expected, wrong).truePositives, 0);
  assert.equal(matchFindings(expected, wrong, [judgment({expectedIndex:null,defect:false,remedy:false,reason:'Only an indentation preference; does not identify the null dereference.'})]).falseNegatives, 1);
});

test('mechanism, scope and remedy must all be valid; duplicates remain false positives', () => {
  const actual = [finding('Null input throws here; guard it before access.')];
  assert.equal(matchFindings(expected, actual, [judgment({})]).truePositives, 1);
  for (const key of ['defect','scope','remedy']) assert.equal(matchFindings(expected, actual, [judgment({[key]:false})]).truePositives, 0);
  assert.equal(matchFindings(expected, [...actual,...actual], [judgment({}),judgment({actualIndex:1})]).falsePositives, 1);
  assert.throws(() => matchFindings(expected, [...actual,...actual], [judgment({})]), /Every emitted/);
  assert.throws(() => matchFindings(expected, actual, [judgment({}),judgment({})]), /duplicate/);
});

test('a semantic approval cannot override wrong file/line/rule or negative controls', () => {
  for(const replacement of [{file:'b.js'},{line:2},{ruleId:'other'}]) assert.equal(matchFindings(expected,[{...finding('Null dereference; guard input'),...replacement}],[judgment({})]).truePositives,0);
  assert.equal(matchFindings([], [finding('An adjacent issue')], [judgment({expectedIndex:null})]).falsePositives,1);
});

test('policy cannot erase required improvement or add unknown thresholds', () => {
  assert.throws(()=>validateThresholds({minHeldoutRecallGain:0}),/positive improvement/);
  assert.throws(()=>validateThresholds({minHeldoutNewTruePositives:0}),/positive improvement/);
  assert.throws(()=>validateThresholds({allowTie:true}),/Unknown/);
});

test('holdout splits reject shared defects even with different MR identifiers', async () => {
  const report = await promotionFixture(), suite=JSON.parse(report.suiteText);
  suite.cases.find(row=>row.split==='heldout').source.defectGroupId=suite.cases[0].source.defectGroupId;
  assert.throws(()=>validateSuite(suite),/Defect group split leakage/);
});

test('future holdout freezes and empty semantic reasons cannot promote', async () => {
  const report=await promotionFixture();
  report.coverage.holdout.frozenAt='2099-01-01';
  report.bindingHash=evaluationBindingHash(report);
  assert.equal(validatePromotionEvidence(report).eligible,false);
  const changed=await promotionFixture();
  changed.cases[0].candidate.adjudication.judgments[0].reason='';
  changed.resultsHash=evaluationResultsHash(changed);
  assert.match(validatePromotionEvidence(changed).reasons.join(' '),/reason/);
});

test('changed explanations cannot reuse positive adjudications after rehashing outcomes', async () => {
  const report=await promotionFixture();
  const row=report.cases.find(item=>item.candidate.findings.length);
  row.candidate.findings[0].message='There is no defect; change indentation.';
  // Even an accidentally regenerated reviewer response/result digest cannot rebind an old judge.
  row.candidate.execution.responseText=JSON.stringify({findings:row.candidate.findings,model:row.candidate.execution.observedModel});
  const {sha256}=await import('./lib.js');
  row.candidate.execution.responseHash=sha256(row.candidate.execution.responseText);
  report.resultsHash=evaluationResultsHash(report);
  assert.match(validatePromotionEvidence(report).reasons.join(' '),/adjudication is not bound/);
});
