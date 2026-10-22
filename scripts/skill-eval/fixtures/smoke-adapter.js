// Intentionally deterministic. This exercises subprocess/metric handling, not review quality.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (request.task === 'adjudicate_findings') {
  process.stdout.write(JSON.stringify({ judgments: request.findings.map((finding, actualIndex) => ({ actualIndex, expectedIndex: request.expectedFindings.length ? 0 : null, defect: true, scope: true, remedy: true, reason: 'Deterministic smoke judgment; not semantic review-quality evidence.' })) }));
  process.exit(0);
}
const active = request.skill.files.some((file) => file.content.includes('SMOKE_NULLABLE_COLLECTION'));
const lines = request.code.content.split('\n');
const line = lines.findIndex((line) => /return items\.length/.test(line)) + 1;
const unsafe = active && /items can be null/.test(request.context) && line > 0 && !request.code.content.includes('if (items == null)');
process.stdout.write(JSON.stringify({ findings: unsafe ? [{ ruleId: 'nullable-collection', file: request.code.file, line, message: 'The nullable collection is dereferenced without a guard.' }] : [] }));
