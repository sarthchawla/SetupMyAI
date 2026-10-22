---
name: synthetic-review-candidate
description: Candidate for smoke testing an evaluation runner only.
---

SMOKE_NULLABLE_COLLECTION

For the synthetic nullable collection fixture, flag `items.length` when context explicitly says items can be null and the code lacks `items?.length` or a preceding null guard. An always-present array, an optional length access, and a scoped example string are clean.

This is a deterministic harness smoke fixture, not an evidence-backed review skill.
