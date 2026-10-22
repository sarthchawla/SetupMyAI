# Tests must reach the scenario they claim

Apply when changed tests claim reset behavior, supplied-prop effects, scrolling, or absence of an asynchronous request. Trace the fixture, action and completion barrier through relevant helpers and nearby tests before reporting a gap.

Ask what broken implementation would still pass. Report the concrete escape and the smallest observable check that closes it; a title or a missing assertion alone is insufficient evidence.

- **Reset:** put each field covered by the claimed reset contract away from its reset value before resetting, then observe its reset result. Setting it to the default proves nothing. Read setter/helper behavior; a pre-reset assertion is useful when setup is uncertain, not mandatory after every setter. Account for coverage in other tests rather than demanding every field in every test.
- **Supplied props:** render the supplied value and observe its promised effect. Root presence does not establish forwarded dimensions; querying text never supplied does not establish optional-slot rendering or wrapper omission. Prefer visible behavior or the actual forwarding/rendering contract over assertions on incidental DOM structure.
- **Scrolling:** establish that the intended container exists and actually moves before capturing the scrolled state. A conditional assignment can silently skip a missing element; assigning `scrollTop` can be clamped to zero when the fixture fits. Read back position, await a position change, or use equivalent evidence of movement. Existence, overflow dimensions and an initial-view screenshot alone do not prove scrolling. Respect the claimed direction/extent and any established initial position.
- **No asynchronous request:** observe requests before triggering the action, then await a meaningful completion barrier for the flow that could issue the request before asserting absence. Awaiting a click or a plain-value matcher does not wait for subsequent work. Optimistic UI, arbitrary sleeps and an immediately passing negative poll may finish too early. Use an operation-completion signal, settled response or UI state whose implementation follows all relevant work; inspect the helper before assuming it is a barrier.

Preserve useful smoke tests and coverage split across layers. A happy-path E2E test need not repeat a component assertion already protected by a unit test. Do not require unchanged screenshot baselines to be regenerated. Limit findings to a demonstrated gap in the claimed behavior; do not turn these checks into an exhaustive assertion checklist.

Include the offending line, how the test can pass without exercising its claim, relevant counterevidence and a correction consistent with the test's scope. A passing test alone neither proves this gap nor disproves it.
