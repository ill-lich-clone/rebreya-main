# Rebreya Main Static Audit Design

**Date:** 2026-08-25

**Status:** Approved for audit

## Goal

Perform one repository-wide, evidence-backed static audit of `rebreya-main` and identify JavaScript defects, logic errors, integration incompatibilities, state-reliability risks, incomplete behavior, missing or partial automation, test gaps, dead routes, and material UX or maintainability problems.

The audit must prioritize observable behavior and concrete failure paths. It must not mix confirmed findings with unsupported suspicions.

## Scope

The audit includes:

- JavaScript syntax, runtime, asynchronous-control-flow, error-handling, and data-shape defects;
- logic that conflicts with the contracts of Foundry VTT 13, dnd5e, `statuscounter`, declared optional integrations, the module README, its data, or its tests;
- failures in normal player or GM workflows that can lose, duplicate, corrupt, or desynchronize world state;
- broken or unreliable UI-to-API-to-socket-to-service-to-repository routes;
- incomplete, unreachable, duplicate-owner, legacy, or explicitly deferred behavior;
- test gaps that create false confidence about material behavior;
- every shipped entity with mechanical text whose promised behavior has no explicit automation or only partial automation;
- every relevant `TODO`, `FIXME`, manual-processing note, "not implemented" statement, or statement that further work is required;
- material UX and maintainability issues when they have an observable cost or raise the probability of a defect.

The audit excludes intentional cheating or payload forgery by players. Permission and routing defects remain in scope when they can break ordinary honest player or GM actions.

## Audit Mode and Non-Goals

- The audit is static. Do not launch Foundry and do not perform live runtime tests.
- Do not fix production code, change module data, add tests, refactor, or update the function passport during the audit.
- A proposed regression test may be described in a finding, but it is not implemented in this phase.
- Do not treat style preferences, speculative abuse cases, or unsupported architectural opinions as findings.
- The audit report is the only planned repository artifact from the audit phase.

## Sources of Evidence

Primary evidence comes from:

- tracked module source, templates, styles, JSON catalogs, macros, automation registries, activities, effects, tests, `module.json`, and relevant README contracts;
- targeted sections of `docs/function-passport.md`, located with `rg` rather than reading the passport wholesale;
- local source and manifests for the installed Foundry VTT, dnd5e, `statuscounter`, and other declared integrations;
- statically read documents and compendia from the review copy of the world at `D:\FoundryVTT\Data\worlds\testovyj3-review-20260825`, without launching Foundry or mutating the copy;
- official upstream documentation only when the installed local source does not establish the required contract.

Large source PDFs, XLSX files, and setting documents are consulted only when a shipped entity explicitly references them or a discrepancy requires checking the primary source. The main subject is behavior and content actually shipped or published by the module.

## Finding Standard

A confirmed finding must include:

- a stable ID, category, `P0`-`P3` priority, and high or medium confidence;
- exact file and line references, or an exact data/document identity when a line reference is not available;
- expected and actual behavior;
- a realistic non-adversarial trigger;
- the relevant call path or data flow;
- concrete evidence from source logic, a data contract, an installed API contract, or an existing test;
- affected versions and integrations;
- a proposed regression test;
- a concise direction for remediation.

Low-confidence suspicions do not appear as confirmed findings. They are recorded separately under "Requires additional verification" with the missing evidence stated explicitly.

For an automation gap, the evidence must name the entity, identify the mechanical promise in its text, enumerate the relevant registries/hooks/macros/activities/effects that were checked, and classify the implementation as complete, partial, or absent. Absence of a keyword alone is not evidence.

## Priority Model

- `P0`: deterministic data corruption or loss, module-wide load failure, or a failure that makes a core world unusable.
- `P1`: a common core workflow is broken, state can become inconsistent, a supported integration is materially incompatible, or a major promised mechanic is absent.
- `P2`: localized incorrect behavior, partial automation, a recoverable failure path, or a meaningful test/UX defect.
- `P3`: contained incompleteness, maintainability debt, stale/dead behavior, or a low-impact gap with a concrete cost.

Categories are `JavaScript`, `Logic`, `State`, `Compatibility`, `Automation`, `Incomplete`, `Testing`, `UX`, and `Maintainability`. Priority and category are independent.

## Two-Pass Method

### Pass 1: baseline and coverage inventory

The controller must:

1. run the mandatory Git preflight from `AGENTS.md`, fetch `origin`, compare `lich_branch` with its remote and with `origin/main`, and stop if repository state is unsafe;
2. record the reviewed commit and installed module/system versions;
3. run the complete Node test suite, JavaScript syntax checks, and JSON parsing checks required by `AGENTS.md` once on the reviewed commit;
4. run the focused Python test if its local runtime dependencies are available, otherwise record the limitation;
5. inventory public APIs, lifecycle hooks, socket commands, settings, repositories, application coordinators, automation registries, shipped mechanical catalogs, templates, and integration adapters;
6. collect explicit incompleteness markers and create a mechanical-entity-to-automation manifest;
7. assign every in-scope directory and manifest group to exactly one primary review owner.

### Pass 2: parallel deep review

Use three independent subagents plus the controller:

1. **State and operations:** application services, repositories, transactions, sockets, active-GM selection, recovery, idempotency, trade, inventory, storage, downtime, rest, and other world mutations.
2. **Automation and compatibility:** combat, classes, races, spells, feats, items, Foundry/dnd5e behavior, third-party adapters, and mechanical-text-to-automation matching.
3. **Composition and call surfaces:** `scripts/main.js`, lifecycle, hooks, public API, UI, templates, error presentation, unreachable or duplicate routes, and the quality of existing tests.
4. **Controller:** maintain the coverage manifest, inspect cross-layer seams, validate all `P0`/`P1` findings independently, deduplicate findings, reject style-only comments, and run relevant existing focused tests for suspected defects.

Agents must receive bounded path and owner assignments. They must use targeted `rg` searches and narrow file ranges and must not load large files or the function passport wholesale.

## Coverage Manifest

The final coverage appendix must account for:

- every tracked code, template, style, and shipped data area;
- every public API group, hook group, socket command group, setting/repository owner, and declared integration;
- every shipped entity containing mechanical behavior;
- every explicit incompleteness marker;
- every test file and the owner behavior it purports to cover;
- areas that could not be verified statically and the exact reason.

Pure narrative content may be marked non-mechanical after inspection. It does not require an automation implementation.

## Deliverable

Save the durable report as:

`docs/reviews/2026-08-25-rebreya-main-audit.md`

The report contains:

1. executive summary and reviewed commit;
2. confirmed findings ordered by priority;
3. automation coverage table;
4. explicit incompleteness-marker table;
5. test gaps and misleading-test findings;
6. "Requires additional verification" items;
7. coverage manifest and static-analysis limitations;
8. verification commands with passed/failed counts and real errors;
9. prioritized remediation sequence without implementing fixes.

After review and self-check, stage only the report, commit it on `lich_branch`, and push it to `origin/lich_branch`. The chat handoff gives a concise summary, the highest-priority findings, verification counts, the report link, and a recommended separate next task for remediation.

## Completion Criteria

The audit is complete only when:

- all in-scope areas appear in the coverage manifest;
- every shipped mechanical entity has a complete, partial, absent, or not-applicable automation classification;
- every explicit incompleteness marker is triaged;
- all `P0` and `P1` findings have been independently revalidated by the controller;
- confirmed defects and unresolved suspicions are separated;
- the required static checks have been run once on the reported commit and their counts are recorded;
- no production source, data, test, or function-passport file was changed;
- the report is committed and pushed on `lich_branch` without force push.
