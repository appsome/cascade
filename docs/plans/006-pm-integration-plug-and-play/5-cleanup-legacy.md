---
id: 006
slug: pm-integration-plug-and-play
plan: 5
plan_slug: cleanup-legacy
level: plan
parent_spec: docs/specs/006-pm-integration-plug-and-play.md
depends_on: [2-migrate-trello.md, 3-migrate-jira.md, 4-migrate-linear.md]
status: pending
---

# 006/5: Delete legacy registration infrastructure

> Part 5 of 5 in the 006-pm-integration-plug-and-play plan. See [parent spec](../../specs/006-pm-integration-plug-and-play.md).

## Summary

Mechanical cleanup. By the end of plans 006/2–006/4, all three real providers are on the manifest, the conformance harness runs them, and the legacy registration sites (`bootstrap.ts`, `builtins.ts`, the manifest-registry fallback path in `extractProjectIdFromJob`, the fallback branch in `pm-wizard.tsx`, the legacy tRPC router `integrationsDiscovery.ts` — minus the endpoints still genuinely in use) contain no behavioral callers.

This plan deletes the dead code, removes the transitional note from the README, and closes the loop. Reverting this plan restores the legacy paths but they remain unreachable — the risk of revert is purely cosmetic.

**Components delivered:**
- `src/integrations/bootstrap.ts` — **deleted**. The three `import './{provider}/index.js'` lines in `src/integrations/pm/index.ts` replace all registration logic.
- `src/triggers/builtins.ts` — Linear/JIRA/Trello registration calls are already gone after plans 006/2–006/4; remaining SCM (`registerGithubTriggers`) + alerting (`registerSentryTriggers`) registrations stay. If all PM registrations are gone, the file may become SCM-and-alerting-only and be renamed or remain as-is.
- `src/router/worker-env.ts::extractProjectIdFromJob` — legacy per-provider if/else deleted; only the registry path remains plus the non-PM job types (`github`, `manual-run`, `retry-run`, `debug-analysis`).
- `web/src/components/projects/pm-wizard.tsx` — remove the legacy fallback branches entirely; manifest path is the only path.
- `src/api/routers/integrationsDiscovery.ts` — audit for remaining endpoints; PM-specific ones that overlap with `pm.discovery.*` are deleted; non-PM endpoints (Sentry, GitHub) stay.
- `src/pm/registry.ts` — legacy `pmRegistry` deleted; any remaining callers migrated to `pmProviderRegistry`.
- `src/integrations/README.md` — transitional note removed; "Legacy path" section removed; file is the single canonical author's guide.
- `tests/helpers/testPMProvider.ts` — kept as a reference implementation (future-provider-author scaffolding) OR deleted if the conformance harness is clear enough without it (decide during plan review).

**Deferred to... nothing. This is the last plan.**

---

## Spec ACs satisfied by this plan

- **Spec AC #4** — **full**: divergent copies are physically impossible now; the seam that allowed `Bearer`-vs-bare-key divergence is gone.
- **Spec AC #6** — **full**: all three providers fully on the new manifest; no legacy infrastructure left.
- **Spec AC #7** — **full**: README is the single authoritative author's guide with no transitional note.

---

## Depends On

- Plan 006/2 (Trello migrated).
- Plan 006/3 (JIRA migrated).
- Plan 006/4 (Linear migrated).

All three must merge before this plan can safely delete the legacy scaffolding.

---

## Detailed Task List (TDD)

### 1. Pre-deletion callsite audit

**Tests first** — these are assertions, not new tests:
- `grep -rE "pmRegistry\\." src/ tests/` — expect zero matches (everything uses `pmProviderRegistry`).
- `grep -rE "from ['\"].*/bootstrap['\"]" src/` — expect zero matches (no imports of the deleted file).
- `grep -rE "registerTrelloTriggers|registerJiraTriggers|registerLinearTriggers" src/ tests/` — expect zero matches.
- `grep -rE "state\\.provider === ['\"]trello['\"]|state\\.provider === ['\"]jira['\"]|state\\.provider === ['\"]linear['\"]" web/` — expect zero matches outside tests that intentionally assert fallback behavior (none expected after plans 006/2–006/4).

If any grep surfaces unexpected matches, that's a regression in plans 006/2–006/4. Fix there before proceeding — do not patch around in this plan.

### 2. Delete files and branches

**Implementation**:
- Delete `src/integrations/bootstrap.ts`.
- Delete `src/pm/registry.ts` (`pmRegistry` legacy singleton).
- In `src/triggers/builtins.ts`: confirm only SCM + alerting `registerXxxTriggers` calls remain; the PM registration calls should already be gone from plans 006/2–006/4.
- In `src/router/worker-env.ts`: the `extractProjectIdFromJob` function retains only the registry lookup plus branches for non-PM job types (`github`, `manual-run`, `retry-run`, `debug-analysis`).
- In `web/src/components/projects/pm-wizard.tsx`: delete the `state.provider === 'trello' ? ... : state.provider === 'jira' ? ... : state.provider === 'linear' ? ... : <JiraFieldMappingStep ...>` chain; only the generic-manifest render path remains.
- In `src/api/routers/integrationsDiscovery.ts`: delete PM-specific endpoints consolidated into `pm.discovery.*` (`createTrelloLabel`, `createTrelloLabels`, `createTrelloCustomField`, `createJiraCustomField`, `createLinearLabel`, `createLinearLabels`). Keep SCM/alerting endpoints and Linear/JIRA/Trello discovery endpoints that haven't been consolidated yet (`linearTeams`, `linearTeamDetails`, `jiraProjectDetails`, etc.).

### 3. Remove transitional note from README

**Implementation**:
- `src/integrations/README.md` — delete the transitional note near the top and the "Legacy path" section at the bottom.
- Verify the remaining content is a coherent author's guide.

### 4. Regression sweep

**Tests first** — the full test suite is the regression sweep:
- `npm test` — all previously-passing tests must pass.
- `npm run build` — compiles clean.
- `npm run typecheck` — no new errors.
- `npm run lint` — no new violations.

**Implementation**: fix anything that breaks; typical issues are stale imports and tree-shakeable dead exports.

### 5. Optional: delete TestProvider fixture

**Decision point**: the `TestProvider` in `tests/helpers/testPMProvider.ts` was created in plan 006/1 to prove the harness works. With three real providers exercising the harness, it's no longer strictly necessary. Two options:

- **Delete**: removes a fixture that might drift. Harness now runs only against real providers.
- **Keep**: serves as a reference implementation for future provider authors. A new provider author starts from this file as a template.

**Recommendation**: keep. The README's author guide can reference it as "minimal example". If it drifts, the harness will surface it.

### 6. Repo-wide documentation polish

**Implementation**:
- Walk `docs/` directory for any reference to the legacy integration path (`bootstrap.ts`, `pmRegistry`, per-provider branches). Update pointers to `pmProviderRegistry` and the manifest contract.
- `CLAUDE.md` — confirm the "Integration abstraction" bullet accurately describes the final state (no transitional language).

---

## Test Plan

### Unit tests
- [ ] All tests that previously asserted legacy behavior (e.g., "bootstrap registers Trello") are deleted as their targets are deleted. Net-zero new tests.
- [ ] Conformance harness continues to run Trello + JIRA + Linear green.

### Integration tests
- [ ] End-to-end roundtrip for each provider still green.

### Acceptance tests
- Full CI green.

---

## Acceptance Criteria (per-plan, testable)

1. `src/integrations/bootstrap.ts` does not exist.
2. `src/pm/registry.ts` does not exist (legacy `pmRegistry`).
3. `src/router/worker-env.ts::extractProjectIdFromJob` has no PM-provider-specific branches — only the registry lookup plus non-PM job-type branches.
4. `web/src/components/projects/pm-wizard.tsx` has no `state.provider === 'trello' | 'jira' | 'linear'` branches.
5. `src/api/routers/integrationsDiscovery.ts` has no PM-specific create endpoints that overlap with `pm.discovery.*`.
6. `src/integrations/README.md` has no transitional note and no "Legacy path" section.
7. `CLAUDE.md` has no stale references to the legacy abstraction.
8. Conformance harness passes against Trello + JIRA + Linear.
9. All existing tests pass unchanged (except assertions that explicitly tested legacy registration paths — those are deleted).
10. `npm run build` passes.
11. `npm test` passes.
12. `npm run lint` passes.
13. `npm run typecheck` passes.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Remove transitional note + legacy-path section |
| `CLAUDE.md` | Confirm "Integration abstraction" bullet reflects final state |
| `CHANGELOG.md` | Entry: "Internal: delete legacy PM registration infrastructure; manifest is the sole registration path" |

---

## Out of Scope (this plan)

- SCM (GitHub) and alerting (Sentry) refactor — spec-level out of scope; their legacy paths stay.
- Further consolidation of per-provider discovery endpoints (`linearTeams`, `jiraProjectDetails`, `trelloBoards`) into a generic `pm.discovery.getSetupContext` — possible future spec, not this one.
- Gadgets layer, runtime plugin discovery, JSON-schema wizard renderer — all spec-level out of scope.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 bootstrap.ts deleted
- [ ] AC #2 legacy pmRegistry deleted
- [ ] AC #3 extractProjectIdFromJob has no PM-specific branches
- [ ] AC #4 Wizard has no provider-specific branches
- [ ] AC #5 Legacy PM tRPC create endpoints deleted
- [ ] AC #6 README cleaned up
- [ ] AC #7 CLAUDE.md verified
- [ ] AC #8 Conformance harness green
- [ ] AC #9 Existing tests green
- [ ] AC #10 Build passes
- [ ] AC #11 Tests pass
- [ ] AC #12 Lint passes
- [ ] AC #13 Typecheck passes
