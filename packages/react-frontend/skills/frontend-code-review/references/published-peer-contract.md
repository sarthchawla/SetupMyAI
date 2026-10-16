# Published library peer contracts

Apply when a reusable package's `peerDependencies`, or inputs to its packaging
transform, change. Application `dependencies` pins, development tools and
unchanged lockfile resolutions are outside this check.

Trace the source manifest through catalog/workspace resolution, build and
publish configuration to the manifest consumers actually install. Inspect the
packed `package.json` at the reviewed revision using the project's existing safe
pack command or a supplied artifact; do not publish. A source `catalog:` entry
or a workspace's installed version alone does not establish the shipped peer
string. If packing is unavailable, record the missing artifact evidence and
use a verified transform only as far as it proves the resulting contract.

Compare each resulting peer range with the package's evidenced support policy,
consumer contracts and compatibility tests:

- Does it reject a compatible consumer the package promises to support? An
  exact pin can exclude supported patch/minor versions; widen only as far as
  compatibility evidence supports. A deliberately supported single version
  can legitimately have an exact peer pin.
- Does it admit future majors beyond the supported/tested major set? An
  open-ended lower bound can make an unsupported compatibility claim. Preserve
  valid multi-major unions and existing upper bounds; do not impose one
  universal range or assume the newest major works.
- Check lower and upper edges, excluded majors and any explicitly supported
  prereleases using actual semver semantics. Do not strip prerelease qualifiers
  or infer an entire supported interval from one installed consumer version.

Report a finding only with the changed source anchor, resulting published peer
string, compatibility evidence, and a concrete supported version rejected or
unsupported major admitted. Propose the smallest range consistent with that
evidence. Missing support/pack evidence is a review gap to clarify, not proof
that a pin or range is wrong. Review each related peer independently.
