# Microsoft Waza schemas

The JSON schemas in this directory are exact copies from Microsoft Waza
`v0.38.3`:

- <https://github.com/microsoft/waza/blob/v0.38.3/schemas/eval.schema.json>
- <https://github.com/microsoft/waza/blob/v0.38.3/schemas/task.schema.json>

Their SHA-256 checksums and immutable upstream URLs are pinned in
`evals/waza.lock.yaml`. They are vendored so schema validation remains
deterministic in restricted or offline CI environments.

Waza is distributed under the MIT License. The upstream license is included
alongside these schema copies.
