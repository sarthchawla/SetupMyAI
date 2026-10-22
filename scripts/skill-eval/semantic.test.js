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

test('a semantic approval cannot override wrong file/rule or negative controls', () => {
  for(const replacement of [{file:'b.js'},{ruleId:'other'}]) assert.equal(matchFindings(expected,[{...finding('Null dereference; guard input'),...replacement}],[judgment({})]).truePositives,0);
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

test('recorded runtime metadata cannot contradict hashed raw model responses', async () => {
  for(const judging of [false,true]) {
    const report=await promotionFixture();
    for(const row of report.cases)for(const arm of ['baseline','candidate']) {
      const execution=judging?row[arm].adjudication.execution:row[arm].execution;
      if(execution)execution.observedModel.version='different-version';
    }
    report.resultsHash=evaluationResultsHash(report);
    assert.equal(validatePromotionEvidence(report).eligible,false);
    assert.match(validatePromotionEvidence(report).reasons.join(' '),/response does not bind/);
  }
});

test('semantic target detection does not become a gain from incidental line anchoring', () => {
  const actual=[{...finding('Null input throws at access; add a guard in the caller.'),line:4}];
  assert.equal(matchFindings(expected,actual,[judgment({})]).truePositives,1);
  assert.equal(matchFindings(expected,actual,[judgment({scope:false,reason:'The cited line is unrelated to this defect.'})]).truePositives,0);
});

test('posthoc grading repair cannot become prospective promotion evidence', async () => {
  const report=await promotionFixture();report.grading.posthoc=true;report.bindingHash=evaluationBindingHash(report);
  assert.match(validatePromotionEvidence(report).reasons.join(' '),/Posthoc grading repair/);
});

test('reasonable anchors still must be inside supplied code', async () => {
  const report=await promotionFixture(), row=report.cases[0], output=row.candidate;
  output.findings[0].line=999;
  const {sha256}=await import('./lib.js');
  output.execution.responseText=JSON.stringify({findings:output.findings,model:output.execution.observedModel});output.execution.responseHash=sha256(output.execution.responseText);report.resultsHash=evaluationResultsHash(report);
  assert.match(validatePromotionEvidence(report).reasons.join(' '),/outside supplied code/);
});

test('validated adjacent defects are visible and prevent promotion with incomplete oracles', async () => {
  const report=await promotionFixture(), suite=JSON.parse(report.suiteText), row=report.cases.find(item=>item.kind==='clean'&&item.split==='development'), item=suite.cases.find(item=>item.id===row.id);
  const {sha256,adjudicationRequest,metrics,matchFindings}=await import('./lib.js');
  for(const arm of ['baseline','candidate']) {
    const output=row[arm], template=report.cases[0][arm].adjudication.execution;
    output.findings=[{ruleId:'nullable-collection',file:item.code.file,line:1,message:'A distinct valid scoped defect omitted by the oracle; apply the guard.'}];
    output.adjudication={judgments:[{actualIndex:0,expectedIndex:null,defect:true,scope:true,remedy:true,reason:'A distinct real in-scope defect absent from frozen targets.'}],execution:structuredClone(template)};
    output.adjudication.execution.requestHash=sha256(JSON.stringify(adjudicationRequest(item,output.findings,suite.rules)));
    output.adjudication.execution.responseText=JSON.stringify({judgments:output.adjudication.judgments,model:template.observedModel});output.adjudication.execution.responseHash=sha256(output.adjudication.execution.responseText);
    output.execution.responseText=JSON.stringify({findings:output.findings,model:output.execution.observedModel});output.execution.responseHash=sha256(output.execution.responseText);
    output.matching=matchFindings(item.expectedFindings,output.findings,output.adjudication.judgments);
  }
  report.metrics.development=Object.fromEntries(['baseline','candidate'].map(arm=>[arm,metrics(report.cases.filter(row=>row.split==='development'),arm)]));report.resultsHash=evaluationResultsHash(report);
  assert.equal(report.metrics.development.baseline.validAdjacentFindings,1);
  assert.match(validatePromotionEvidence(report).reasons.join(' '),/oracle omits validated adjacent defects/);
});
