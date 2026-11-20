# Software Development Plan: Medication Management System (MMS)

**Course:** CMSI 4071 — Senior Project I
**Deliverable:** Software Development Plan (due Week 07)
**Team:** _[team name]_ — _[member names: to be filled in]_
**Date:** September 11, 2026
**Repository:** `Aaron-CMSI-3300-2-fall-2026`
**Companion documents:** [`proposal.md`](proposal.md) (Week 03), `requirements.md` → SRS (Week 05), `design.md` → SDD (Weeks 10/12)

---

## 1. Introduction

### 1.1 Purpose

This Software Development Plan (SDP) states how the team will build, verify, and deliver the
Medication Management System described in the [project proposal](proposal.md). The proposal
answers *what* and *why*; this document answers *who, how, when,* and *what happens when
something goes wrong*. It is the governing process document for the remainder of the project: if
the plan and actual practice diverge, one of the two is changed deliberately and the change is
recorded in the next status report.

### 1.2 Scope of this plan

The plan covers the full lifecycle of the MMS product and its documentation set from Week 07
through the Week 16 code freeze: role assignment, the development methodology and its ceremonies,
the task schedule and milestones, risk identification and response, internal and external
communication, and configuration management (version control, branching, code review, build,
environments, and release).

### 1.3 Document overview

| Section | Contents |
| --- | --- |
| §2 | Project scope — product boundaries, deliverables, and work breakdown |
| §3 | Team roles and responsibilities |
| §4 | Development methodology |
| §5 | Schedule and milestones |
| §6 | Risk management plan |
| §7 | Communication plan |
| §8 | Configuration management approach |
| §9 | Plan maintenance |

### 1.4 Definitions and acronyms

| Term | Meaning |
| --- | --- |
| **MMS** | Medication Management System, the product |
| **PHI** | Protected Health Information — any patient-identifying health record in the system |
| **EARS** | Easy Approach to Requirements Syntax, the acceptance-criteria format used in the SRS |
| **Property** | One of the 36 machine-verifiable correctness statements derived in the design, each implemented by exactly one property-based test |
| **PBT** | Property-based testing (via `fast-check`), run at ≥100 iterations per property |
| **Wave** | A set of tasks in the dependency graph whose predecessors are all complete, and which may therefore proceed in parallel |
| **Grace period** | The configurable interval after a dose's scheduled time during which the dose may still be logged or its status changed |
| **DoD** | Definition of Done (§4.4) |
| **SDP / SRS / SDD** | Software Development Plan / Requirements Specification / Design Document |

---

## 2. Project Scope

### 2.1 Product scope summary

MMS is a three-tier responsive web application — a React (Vite) single-page client, a stateless
Express JSON API, and a SQLite relational store — with an in-process periodic scheduler and a
single pluggable notification dispatcher. It lets a patient record medications and schedules,
expands those schedules into concrete dose events, reminds the patient at each scheduled time,
logs doses taken or missed, computes adherence, escalates missed doses to designated caregivers,
issues refill reminders, and raises pairwise drug-interaction warnings. Providers get a read view
of their assigned patients' medications, warnings, and adherence. Every PHI access passes through
one authorization policy choke point and writes one audit entry.

The authoritative in-scope / out-of-scope boundary is [`proposal.md` §4](proposal.md), and it is
**treated as frozen for the duration of the project**. In summary:

**In scope.** Medication CRUD with field-level validation; schedule expansion; dose reminders and
one follow-up past grace; dose logging and history; adherence reports; refill thresholds and
refill recording; caregiver contact management with per-medication notification suppression;
memory notes surfaced in reminders; pairwise interaction warnings against a curated rule set;
provider dashboard; session authentication and role-based authorization; audit logging; TLS in
transit and encryption of the database file at rest; a scheduler ticking at ≤60 s with atomic
claiming; WCAG 2.1 AA on patient-facing pages.

**Out of scope.** Clinical decision support beyond pairwise interaction lookup; HIPAA
certification or real PHI; EHR/pharmacy (HL7/FHIR) integration; native mobile apps; production
notification carriers (stub channels ship); caregiver login accounts; multi-tenant organizational
administration.

### 2.2 Deliverable scope

| # | Deliverable | Form | Owner role | Due |
| --- | --- | --- | --- | --- |
| D1 | Project proposal + presentation | `docs/proposal.md`, slides | Project Manager | Week 03 ✅ |
| D2 | Preliminary SRS + project schedule | `docs/srs.md` | Requirements Lead | Week 05 |
| D3 | Software Development Plan | `docs/sdp.md` (this document) | Project Manager | Week 07 |
| D4 | Status reports #1–#4 | `docs/status/NN.md` | Project Manager | Weeks 07, 09, 11, 13 |
| D5 | SDD — architecture section | `docs/sdd.md` §1–§5 | Architect | Week 10 |
| D6 | SDD — detailed design section | `docs/sdd.md` §6+ | Architect | Week 12 |
| D7 | Design review presentation + demo | slides + running system | Whole team | Week 12–13 |
| D8 | User manual | `README.md` | Frontend/UX Lead | Week 13 |
| D9 | Final presentation + demo | slides + running system | Whole team | Week 15 |
| D10 | Final product / code freeze | tagged release `v1.0.0` | Whole team | Week 16 |

### 2.3 Work breakdown structure

The implementation work is decomposed in
[`tasks.md`](../.kiro/specs/medication-management-system/tasks.md) into **21 numbered tasks across
11 dependency waves (0–10)**, with core implementation sub-tasks and separable optional
property-test sub-tasks (marked `*`). At the top level:

| Wave | Tasks | Theme |
| --- | --- | --- |
| 0–2 | 1, 2 | Scaffolding, shared types, entity models, repository interfaces + in-memory fakes, SQLite schema and repositories |
| 3–4 | 3, 4, 6, 10, 11, 12, 17 (partly) | Pure domain logic: schedule expansion, medication lifecycle, dose logging and the missed-dose rule, caregiver contacts, memory notes, notification dispatcher and payload builders, authentication |
| 5–6 | 7, 8, 14, 15, 17 | Adherence computation, interaction detection, refill logic, the scheduler/worker, authorization policy and audit wrapper, plus the bulk of the property tests |
| 7–8 | 18, 19 | JSON API controllers wired through auth/policy/audit; the accessible React SPA |
| 9–10 | 19.3–19.4, 20, 21 | Integration and wiring, reminder-timeliness and confidentiality verification, accessibility checks, final checkpoint |

Documentation work (D2, D3, D5, D6, D8) and presentation work (D7, D9) are tracked as first-class
WBS items alongside the implementation tasks, not as after-the-fact write-ups; see §4.3.

### 2.4 Current baseline

A working vertical slice already exists in the repository, which changes the shape of the
remaining work from *build* to *complete, harden, and verify*:

- `src/domain/` — pure services (schedule, medication, dose log, missed-dose predicate, adherence, interactions, refill, contacts, notes) with 18 co-located test files
- `src/data/` — repository interfaces, in-memory fakes, SQLite implementations
- `src/notifications/` — dispatcher plus pluggable stub channels
- `src/scheduler/`, `src/policy/`, `src/http/`, `src/composition.js` — worker, authorization policy, JSON API, composition root
- `client/` — React + Vite SPA
- `test/` — smoke, repository-contract, and HTTP-smoke tests; `scripts/seed.js` seeds synthetic data

All 21 core tasks are marked complete; the material remaining work is the optional property-test
sub-tasks (the 36 properties), the accessibility verification, the confidentiality and timeliness
smoke tests, and the documentation and presentation deliverables.

### 2.5 Scope change control

Any change to §2.1 requires (a) a written proposal in the team channel naming the requirement
group(s) affected, (b) an explicit team decision at the next standing meeting, and (c) a record
in the next status report with its schedule impact. Silent scope growth is the failure mode this
rule exists to prevent; see Risk R-02.

---

## 3. Team Roles and Responsibilities

### 3.1 Role definitions

Roles are **responsibility areas, not job titles** — every member writes code, writes tests, and
writes documentation. A role owner is accountable for their area being complete and correct, and
is the default reviewer for changes in it.

| Role | Primary responsibilities | Owns |
| --- | --- | --- |
| **Project Manager / Scrum Lead** | Maintains the schedule and this plan; runs standing meetings; authors status reports; enforces the scope-change process; tracks risks in the register; is the point of contact with the instructor | §5, §6, §7, D1, D3, D4 |
| **Architect / Backend Lead** | Owns the layered architecture and its boundaries (pure domain ↛ I/O); owns `src/domain`, `src/data`, `src/composition.js`; authors the SDD; adjudicates design disputes | D5, D6, domain + data layers |
| **Requirements & QA Lead** | Owns the EARS acceptance criteria and the requirement→property→test traceability matrix; owns the test strategy and the CI gate; authors the SRS; verifies the Definition of Done before merge | D2, `test/`, property coverage |
| **Frontend / UX & Accessibility Lead** | Owns `client/` — components, routing, forms, focus management; owns the WCAG 2.1 AA target, the automated axe/Lighthouse checks, and the documented manual-review list; authors the user manual | D8, `client/`, R14 |
| **Security & Data Lead** | Owns authentication, the authorization policy choke point, the audit wrapper, TLS configuration, and at-rest encryption of the database file with a runtime-supplied key; owns the SQLite schema's integrity constraints | `src/policy`, `src/http/middleware.js`, R11–R12 |
| **Release & Infrastructure Lead** | Owns branching, code-review hygiene, the build and seed scripts, environment configuration, versioning, and tagged releases | §8, `scripts/`, CI |

### 3.2 Assignment matrix

Fill in member names before submission. Multiple roles per member are expected on a small team;
no requirement group may be left without a named owner.

| Member | Primary role | Secondary role | Requirement groups owned |
| --- | --- | --- | --- |
| _[name]_ | Project Manager | Requirements & QA | R8 (Adherence Reports) |
| _[name]_ | Architect / Backend | Release & Infrastructure | R1, R3, R7 (Medication, Logging, Interactions) |
| _[name]_ | Requirements & QA | Security & Data | R2, R4, R5, R13 (Reminders, Alerts, Refills, Reliability) |
| _[name]_ | Frontend / UX & Accessibility | — | R6, R9, R10, R14 (Dashboard, Contacts, Notes, Accessibility) |
| _[name]_ | Security & Data | Architect / Backend | R11, R12 (Auth, Privacy) |

### 3.3 Responsibility assignment (RACI) for the deliverables

`R` responsible · `A` accountable · `C` consulted · `I` informed

| Deliverable | PM | Architect | QA | Frontend | Security | Release |
| --- | --- | --- | --- | --- | --- | --- |
| SRS (D2) | A | C | R | C | C | I |
| SDP (D3) | R/A | C | C | C | C | C |
| Status reports (D4) | R/A | I | C | I | I | I |
| SDD architecture (D5) | A | R | C | C | C | I |
| SDD detailed (D6) | A | R | C | R | R | I |
| Design review demo (D7) | A | R | R | R | R | R |
| User manual (D8) | A | C | I | R | C | C |
| Final demo (D9) | A | R | R | R | R | R |
| Code freeze / release (D10) | A | C | R | C | C | R |

### 3.4 Decision rights and escalation

1. **Within a role's area** — the owner decides.
2. **Across boundaries** (e.g. a domain change that alters the API contract) — the two owners
   agree; the Architect breaks ties on technical grounds.
3. **Scope, schedule, or plan changes** — the whole team decides at a standing meeting; the PM
   records the decision (§2.5).
4. **Unresolved after one meeting** — the PM escalates to the instructor rather than letting the
   item block a wave.

### 3.5 Workload commitment

Each member commits a nominal **8–10 hours per week**. A member who cannot meet their commitment
in a given week raises it at the standing meeting so tasks can be reassigned within the wave
rather than discovered as a missed milestone (Risk R-06).

---

## 4. Development Methodology

### 4.1 Chosen approach: specification-first, wave-based iterative development

The team uses an **iterative, wave-based process driven by a written specification** — Agile
ceremonies and incremental delivery, but with requirements and design authored *up front and
maintained as living documents* rather than discovered sprint by sprint.

The rationale is specific to this project:

- **The riskiest logic is time math.** Grace periods, missed-dose designation, adherence
  arithmetic, and retry decisions are cheap to specify precisely and expensive to discover
  empirically. They belong in a specification before they are coded.
- **The course requires a documentation set anyway** (SRS, SDD). Authoring those as the
  specification the implementation follows means documentation is a byproduct of building rather
  than a separate end-of-term write-up. This is the primary mitigation for Risk R-03.
- **The dependency graph is already known.** 21 tasks in 11 waves with explicit predecessors gives
  a natural iteration boundary — a wave — and makes parallelism across members obvious.
- **Pure functions make testing the schedule lever.** Because implementation sub-tasks and
  optional property-test sub-tasks are separable, the team can ship a correct MVP with some tests
  deferred instead of shipping half the feature set.

This is not waterfall: requirements and design are revised whenever implementation exposes a
defect in them, and every wave ends with running, demonstrable software.

### 4.2 Iteration cadence

| Ceremony | When | Duration | Output |
| --- | --- | --- | --- |
| **Iteration planning** | Monday of each odd week | 30 min | The wave's tasks assigned to members with the DoD agreed |
| **Standing meeting** | Monday and Thursday | 15 min | Progress, blockers, reassignments |
| **Checkpoint** | End of each wave (tasks 5, 9, 13, 16, 21 are explicit checkpoints) | 30 min | Full test suite green; demo of the wave's increment |
| **Iteration review + retrospective** | Friday of each even week | 45 min | Status-report input; one concrete process change |

Iterations are **two weeks** and aligned to the biweekly status-report cadence, so each report
documents exactly one completed iteration.

### 4.3 Documentation-as-specification workflow

1. A requirement group is written in EARS form in `requirements.md`.
2. The design derives machine-verifiable **properties** from those criteria in `design.md`; each
   property names the criteria it validates.
3. `tasks.md` decomposes the design into tasks, each citing the requirement sub-clauses it
   implements and, for `*` sub-tasks, the single property it tests.
4. Implementation follows the task. If the task is wrong, the requirement or design is corrected
   *first*, then the code — never the reverse.
5. The SRS and SDD deliverables are edited views of these same artifacts, which is why they cannot
   drift from the product.

This chain — **requirement → property → test → task** — is the project's traceability backbone,
and the QA Lead's matrix is the single place it is checked.

### 4.4 Definition of Done

A task is done only when all of the following hold:

1. The core implementation sub-tasks are complete and the code is merged to `master`.
2. `npm test` passes locally and in CI, with no skipped tests other than declared `*` sub-tasks.
3. Any property claimed by the task is covered by **exactly one** `fast-check` property test
   running **≥100 iterations**, tagged `Feature: medication-management-system, Property {n}: {text}`.
4. Domain logic added under `src/domain/` contains no I/O, no Express, and no clock access other
   than an injected clock.
5. Every new PHI-touching route passes through session validation, the policy layer, and the audit
   wrapper.
6. Patient-facing UI changes keep semantic markup, keyboard operability, text alternatives, and
   focus management intact, and pass the automated accessibility check.
7. Requirement traceability is updated: the task's requirement sub-clauses are marked covered.
8. The change was reviewed and approved by at least one other member (§8.4).

### 4.5 Testing strategy

| Layer | Technique | Tooling | Gate |
| --- | --- | --- | --- |
| Pure domain logic | Property-based tests, ≥100 iterations, generators aimed at boundary values (the grace boundary, an empty reporting period, supply exactly equal to the threshold, an empty caregiver set) | `fast-check` + `node --test` | All 36 properties, one test each |
| Repositories | Contract tests run against both the in-memory fake and SQLite | `node --test` | `test/repository-contract.test.js` |
| API + authorization | Integration tests per PHI route: patient own-record, provider assigned, unauthenticated, unassigned, revoked | `node --test` | Task 18.2 |
| Scheduler / notifications | Controllable-clock integration tests: dispatch within 60 s, tick ≤60 s, retry-then-undelivered, all three notification types | `node --test` | Tasks 20.2–20.3 |
| Confidentiality | Configuration smoke tests: TLS required; the database file is not plaintext-readable without the runtime key | `node --test` | Task 20.4 |
| Accessibility | Automated axe-core/Lighthouse subset on patient-facing pages, plus a documented manual-review list for criteria automation cannot cover | axe-core, Lighthouse | Task 19.4 |

**Test-first is required for the pure domain layer** — a property test may be written before or
alongside the function, but never after the task is closed — and recommended elsewhere.

### 4.6 Technology stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js ≥ 20 | ESM (`"type": "module"`) |
| API | Express 4 | Stateless; JSON only |
| Database | SQLite via `better-sqlite3` 11 | Parameterized queries throughout; encrypted file at rest |
| Client | React + Vite | Client-side routing; `/api` proxied in dev, production build served by the backend |
| Tests | `node --test` + `fast-check` 3 | No additional runner |
| Accessibility | axe-core, Lighthouse | Automated subset of WCAG 2.1 AA |
| Version control | Git | See §8 |

No paid services and no external hosting are required to build, test, or demonstrate the system.

---

## 5. Schedule and Milestones

### 5.1 Milestone schedule

| ID | Milestone | Week | Exit criteria |
| --- | --- | --- | --- |
| M1 | Proposal delivered and presented | 03 ✅ | `docs/proposal.md` submitted; presentation given |
| M2 | Preliminary SRS + schedule delivered | 05 | All 14 requirement groups in EARS form; traceability-matrix skeleton exists |
| M3 | **SDP delivered** (this document) + Status #1 | 07 | Roles assigned with names; risk register populated; the CM approach in force in the repository |
| M4 | Domain layer verified | 09 | Waves 0–6 complete; Properties 1–23 and 25–32 each covered by one passing property test; Status #2 |
| M5 | SDD architecture section delivered | 10 | `docs/sdd.md` §1–§5 submitted; the described architecture matches the code |
| M6 | Security and API layer verified | 11 | Properties 33–36 covered; task 18.2 role-based access integration tests pass; Status #3 |
| M7 | SDD detailed design + design review demo | 12–13 | End-to-end patient and provider flows demonstrated live on seeded synthetic data; automated accessibility checks pass |
| M8 | User manual + Status #4 | 13 | `README.md` complete enough for an unfamiliar user to install, seed, run, and exercise both flows |
| M9 | Feature complete | 14 | All 21 tasks and all 36 property tests done; integration tests 20.2–20.4 pass |
| M10 | Final presentation and demonstration | 15 | Full demo rehearsed and delivered; no known defect in the demo path |
| M11 | **Code freeze / final delivery** | 16 | `v1.0.0` tagged; full test suite green; all documentation complete and consistent with the code |

### 5.2 Wave schedule

| Weeks | Waves | Focus | Milestone |
| --- | --- | --- | --- |
| 07–08 | 4–5 (test sub-tasks) | Property tests for medication, dose logging, contacts, notes, notification payloads and retry | → M4 |
| 09 | 6–7 (test sub-tasks) | Adherence, interaction, refill, and scheduler property tests | M4 |
| 10 | — | SDD architecture authoring; defect repair from M4 | M5 |
| 11 | 7–8 | Auth/policy/audit property tests; route-level access integration tests | M6 |
| 12 | 8–9 | SPA warning-display property test; accessibility checks; SDD detailed design | M7 |
| 13 | 9–10 | Integration, timeliness, and confidentiality tests; user manual | M7, M8 |
| 14 | 10 | Feature-complete hardening; defect burn-down | M9 |
| 15 | — | Rehearsal and final demonstration; documentation consistency pass | M10 |
| 16 | — | Freeze, tag, submit | M11 |

### 5.3 Critical path

`Wave 0 → 1 → 2 (SQLite repositories) → 3 (schedule expansion, authentication) → 4 (dose logging,
dispatcher, policy) → 6 (scheduler) → 7 (JSON API) → 8 (SPA) → 9 (wiring) → 10 (integration
verification)`

The implementation critical path is already traversed (§2.4). The **remaining** critical path runs
through verification and documentation: Properties 33–36 (auth/authorization/audit) → route-level
access integration tests → accessibility verification → SDD detailed design → final demo. A slip
in the security property tests delays M6, M7, and the design review in sequence, so they are
scheduled ahead of the less coupled work.

### 5.4 Schedule buffer and the MVP lever

- Week 14 is deliberately a hardening week with no new deliverable, giving one week of buffer
  before the final demonstration.
- If the schedule tightens, the declared lever is **deferring optional `*` property sub-tasks in
  reverse risk order** — UI-display properties first, time-math and security properties last and
  only with an explicit team decision recorded in a status report. The lever is never "cut a
  feature group," because a partial feature set cannot be demonstrated end to end.

---

## 6. Risk Management Plan

### 6.1 Process

Risks are tracked in a register maintained by the PM in `docs/status/risks.md`. Each risk carries
an owner, probability, impact, exposure (P × I), a mitigation (reduce likelihood), a contingency
(what to do if it occurs), and a trigger (the observable signal that it *has* occurred).
Probability and impact are scored 1 (low) – 5 (high). The register is reviewed at every iteration
review, and its material changes are reported in each status report.

### 6.2 Risk register

| ID | Risk | Owner | P | I | Exp | Mitigation | Contingency | Trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R-01** | Time-based logic (grace period, DST, boundary instants) is subtly wrong | Architect | 4 | 5 | 20 | Keep all time logic pure and clock-injected; one property test per behavior at ≥100 iterations with generators aimed at boundary values; explicit cases for "exactly at scheduled time + grace" | Freeze the affected service, write a failing property reproducing the case, fix it, and re-run the whole property suite before other work proceeds | Any property test in `dose-log-service`, `missed-dose`, `schedule`, or `adherence-service` fails, or a demo shows an off-by-one dose |
| **R-02** | Scope creep toward real clinical features (dosing advice, allergy checks, EHR integration) | PM | 3 | 4 | 12 | Proposal §4.2 is frozen; §2.5 change control requires a team decision and a status-report entry | Reject the change; if already started, revert it and record the cost in the status report | A task appears that cites no requirement sub-clause |
| **R-03** | Documentation deadlines crowd out implementation | PM | 4 | 4 | 16 | Documentation authored *as* the working specification (§4.3); the SRS/SDD are edited views of `requirements.md` / `design.md`; documentation owners named in §3.3 | Invoke the MVP lever (§5.4) to free implementation hours; never trade away a graded document | Two consecutive standing meetings report no progress on the current document deliverable |
| **R-04** | Accessibility problems discovered late, forcing an expensive SPA retrofit | Frontend Lead | 3 | 4 | 12 | Semantic HTML, keyboard operability, focus management, and text alternatives are baseline requirements from the first component; an automated axe check on every patient-facing view | Scope the retrofit to the demo path first, then the remainder; document unmet criteria honestly rather than overclaiming AA conformance | An axe/Lighthouse run reports a violation class not seen before, or a keyboard-only walkthrough fails |
| **R-05** | Notification delivery failures lose safety-relevant alerts silently | Security & Data Lead | 3 | 5 | 15 | One dispatcher for all outbound messages; every failure recorded; retry to a configured maximum with `attemptCount ≤ maxAttempts` enforced as an invariant; exhausted notifications marked undelivered for operator review | Replay undelivered notifications from the store once the channel recovers; add the missed case as a property test | A notification reaches `undelivered` during a demo, or Property 36 fails |
| **R-06** | Member unavailability (illness, course load, competing deadlines) | PM | 4 | 3 | 12 | Every area has a named secondary (§3.2); weekly commitment declared (§3.5); no task is knowingly single-owner across a wave boundary | Reassign the wave's tasks at the standing meeting; pull work forward from the Week 14 buffer | A member misses two consecutive standing meetings or reports under half their committed hours |
| **R-07** | The at-rest encryption approach (a SQLCipher-style build or host volume encryption) proves awkward on team machines | Security & Data Lead | 3 | 3 | 9 | Treated as a deployment concern that does not touch domain logic; the key is supplied at runtime from a secret store, never stored beside the file; verified by a configuration smoke test rather than by inspection | Fall back to host disk/volume encryption for the demonstration and document the exact control in effect and its limitations | Task 20.4's at-rest check cannot be made to pass on a team machine |
| **R-08** | Authorization logic drifts as routes are added, leaking PHI across patients | Security & Data Lead | 2 | 5 | 10 | A single `authorize(identity, action, resource)` choke point; no per-handler authorization; route-level integration tests assert denial for unauthenticated, unassigned, and revoked identities on every PHI endpoint | Treat as a stop-the-line defect: add the missing route to the integration matrix, fix it, and audit every other route before resuming feature work | A PHI route exists that is not covered by task 18.2's integration matrix |
| **R-09** | An audit-write failure silently permits PHI access | Security & Data Lead | 2 | 4 | 8 | The audit wrapper fails **closed** — an audit-write failure fails the operation; exactly one entry per PHI access, asserted by Property 35 | Fix the wrapper and review the audit table for gaps in the affected window | Property 35 fails, or an access appears in logs without a matching audit entry |
| **R-10** | Environment drift between team machines and the demo machine (Node version, native `better-sqlite3` build, ports) | Release Lead | 3 | 3 | 9 | `engines.node >= 20` declared; committed lockfiles; a documented install/run/seed procedure in `README.md`; the same `npm test` gate everywhere; synthetic data via `scripts/seed.js` | Rehearse the final demo on the actual demo machine in Week 15; keep a second machine ready as a fallback | A clean clone fails `npm install && npm test` on any member's machine |
| **R-11** | Integration is deferred so long that wiring defects surface at the demo | Architect | 2 | 4 | 8 | Every wave ends at a checkpoint with the full suite green; the composition root is already wired end to end (§2.4); an HTTP smoke test runs in CI | Pull integration work forward from the Week 14 buffer and cut the last non-critical property tests | A checkpoint ends without a runnable demo of that wave's increment |
| **R-12** | Data loss in the working repository (local-only work, a lost branch, a corrupted database file) | Release Lead | 2 | 3 | 6 | Push at least daily; no long-lived local-only branches; the database is disposable and reproducible from `scripts/seed.js`; database files are `.gitignore`d and never committed | Recreate from the last pushed commit and re-seed; the database is never the source of truth for anything graded | A member reports uncommitted work older than one day |

### 6.3 Top risks and their standing responses

The three highest-exposure risks drive concrete, already-scheduled work rather than intentions:

1. **R-01 (time math, exposure 20)** — retired by the property suite; the time-related properties
   are the last ones the MVP lever is allowed to touch.
2. **R-03 (documentation vs. implementation, 16)** — retired structurally by §4.3: the
   specification the team codes against *is* the graded document.
3. **R-05 (silent alert loss, 15)** — retired by architecture: exactly one dispatcher, every
   failure recorded, retries bounded by an enforced invariant, exhaustion made visible.

---

## 7. Communication Plan

### 7.1 Channels

| Channel | Purpose | Expected response |
| --- | --- | --- |
| **Team chat** (Discord/Slack; `#general`, `#backend`, `#frontend`, `#blockers`) | Day-to-day coordination, blockers, quick decisions | Within 12 hours on weekdays; `#blockers` within 4 |
| **Standing meetings** (Mon/Thu, 15 min, video) | Progress, blockers, reassignment | Attendance required; absence notified in advance |
| **Iteration planning / review** (odd-Mon / even-Fri) | Wave assignment; increment demo; retrospective | Attendance required |
| **Git repository** (commits, branch names, pull-request descriptions) | The authoritative record of *what changed and why* | Review within 24 hours (§8.4) |
| **`docs/`** | The authoritative record of requirements, design, plan, and status | Updated in the same change as the code it describes |
| **Email to the instructor** (sent by the PM) | Deliverable submission, clarification requests, escalation | Sent at least 48 hours before a deliverable when a clarification is needed |
| **Status reports** (`docs/status/NN.md`, Weeks 07/09/11/13) | Formal external reporting | Submitted on the due date |

### 7.2 Meeting protocol

Every standing meeting answers three questions per member — *what closed since last time, what is
next, what is blocked* — and nothing else; design discussion moves to the relevant topic channel or
to a scheduled design session. The PM records decisions and action items with owners in the channel
immediately after the meeting; an undocumented decision is not a decision.

### 7.3 Status report contents

Each status report states, in this order:

1. Milestones reached and milestones missed since the last report, with reasons.
2. Tasks and waves completed; property-test coverage (of 36) and requirement coverage (of 14 groups).
3. Material risk-register changes: new risks, retired risks, and any triggered contingency.
4. Scope changes approved under §2.5, with their schedule impact.
5. Plan deviations and the corresponding plan amendment (§9).
6. The next report's targets.

### 7.4 Escalation path

A blocker is raised in `#blockers` → unresolved after 24 hours → taken to the standing meeting →
unresolved after one meeting → the PM escalates to the instructor. A blocker is never allowed to
sit silently through a wave; the cost of asking early is always lower than the cost of a missed
milestone.

### 7.5 External communication

- The instructor is the only external stakeholder; all formal communication goes through the PM.
- No real patient data, credentials, or secrets are ever posted in chat, committed, or shared;
  demonstration data is synthetic and generated by `scripts/seed.js`.
- Presentations (D1, D7, D9) are rehearsed once in full before delivery, with the demo run on the
  machine that will be used on the day (Risk R-10).

---

## 8. Configuration Management Approach

### 8.1 Configuration items

| Item | Location | Controlled by |
| --- | --- | --- |
| Backend source | `src/` | Git |
| Client source | `client/src/` | Git |
| Tests | `src/**/*.test.js`, `test/` | Git |
| Specifications | `.kiro/specs/medication-management-system/{requirements,design,tasks}.md` | Git |
| Deliverable documents | `docs/` | Git |
| User manual | `README.md` | Git |
| Build/dependency manifests | `package.json`, `package-lock.json`, `client/package.json`, `client/package-lock.json`, `client/vite.config.js` | Git; lockfiles committed |
| Seed and utility scripts | `scripts/` | Git |
| Secrets and runtime configuration | `.env` (local only); the secret store holding the database key | **Never committed** |
| Database files | `mms.db*` | **Never committed**; reproducible via `npm run seed` |
| Build output | `client/dist/` | **Never committed**; produced by `npm run build:client` |

Derived, secret, and machine-specific artifacts are excluded by `.gitignore` (`node_modules/`,
`client/node_modules/`, `client/dist/`, `*.log`, `*.sqlite`, `*.db`, `*.db-wal`, `*.db-shm`,
`.env`, `client/.env`). The rule is simple: **if it can be regenerated or must stay secret, it is
not in the repository.**

### 8.2 Version control

- **Repository:** the existing Git repository `Aaron-CMSI-3300-2-fall-2026`, hosted remotely with
  every member as a collaborator.
- **Integration branch:** `master` is the single integration branch and must be green at all times
  — a clean clone must pass `npm install && npm test`.
- **Push cadence:** at least daily; no work stays local overnight (Risk R-12).
- **No force-pushes to `master`**, ever. Rewriting history is permitted only on one's own unmerged
  feature branch.

### 8.3 Branching and commits

**Branch naming** — `<type>/<task-or-topic>`, where `type` ∈ {`feat`, `fix`, `test`, `docs`,
`chore`}:

```
feat/17.2-authorization-policy
test/property-11-missed-dose-boundary
docs/sdp
fix/adherence-empty-period
```

One branch per task or sub-task, kept short-lived (ideally under two days) and rebased on `master`
before review to keep history linear.

**Commit convention** — Conventional Commits, with the task or property referenced in the body so
that `git log` participates in traceability:

```
test(domain): cover missed-dose grace boundary

Implements Property 11 (missed-dose designation matches the grace-period
rule) at 200 iterations, with a generator that hits exactly
scheduledTime + gracePeriod.

Task: 6.4   Requirements: 3.3
```

Commits are small and single-purpose; a commit that touches a domain service, the API, and the SPA
at once is split.

### 8.4 Code review

Every change reaches `master` through a pull request. Rules:

1. **One approving review** from a member other than the author; the role owner of the touched area
   is the default reviewer (§3.1).
2. **The CI gate must pass** before an approval is meaningful (§8.5).
3. **The reviewer verifies the Definition of Done** (§4.4) — not just that the code reads well, but
   that the property test exists at ≥100 iterations, that domain purity is intact, that PHI routes
   pass through policy and audit, and that traceability is updated.
4. **Review within 24 hours** of the request; a stalled review is raised in `#blockers`.
5. **Changes to `src/policy/`, `src/http/middleware.js`, or the SQLite schema additionally require
   the Security & Data Lead's approval** (Risks R-08, R-09).
6. The pull-request description says *what changed, why, which task and requirements it serves, and
   how it was verified*.

### 8.5 Build, test, and the CI gate

| Command | Purpose |
| --- | --- |
| `npm install && npm install --prefix client` | Install backend and client dependencies |
| `npm test` | Full backend + domain test suite (`node --test`) |
| `npm run seed` | Create or refresh the synthetic demonstration database |
| `npm start` | Run the API (serves the built SPA in production mode) |
| `npm run dev:client` | Vite dev server, proxying `/api` to the backend |
| `npm run build:client` | Production SPA build into `client/dist/` |

The CI gate on every pull request runs, in order: install from lockfiles, `npm test`, client build.
A red gate blocks merge. Lockfiles are committed so that CI and every member's machine resolve
identical dependency trees (Risk R-10).

### 8.6 Environments

| Environment | Purpose | Data | Configuration |
| --- | --- | --- | --- |
| **Local development** | Day-to-day work | Synthetic, from `npm run seed` | Local `.env`; database key supplied at runtime |
| **CI** | Merge gate | Ephemeral, created per run | Repository-level configuration only; the stub channels need no secrets |
| **Demonstration** | M7 design review, M10 final demo | Seeded synthetic accounts | Rehearsed on the demo machine in Week 15; TLS enabled; encrypted database file with the key supplied at runtime |

No environment ever contains real PHI. Notification channels are stubs in every environment; the
dispatcher interface is the only seam a real carrier would replace.

### 8.7 Versioning and releases

- **Scheme:** semantic versioning. The project stays on `0.x` through development; the Week 16
  delivery is **`v1.0.0`**.
- **Release procedure:** (1) `master` green; (2) all 36 properties covered and all 14 requirement
  groups traced; (3) a documentation consistency pass — proposal, SRS, SDD, SDP, and `README.md`
  describe the same system; (4) the client build succeeds; (5) the annotated tag `v1.0.0` is
  pushed; (6) the tag is recorded in the final status report.
- **Milestone tags:** each graded milestone is tagged at submission (`m3-sdp`, `m5-sdd-arch`,
  `m7-design-review`, `m10-final-demo`) so any graded artifact can be reproduced exactly as
  submitted.
- **Code freeze:** after the `v1.0.0` tag, only defect fixes demonstrably necessary for the
  delivered documentation to be accurate may land, each requiring two approvals.

### 8.8 Change control for specifications

Because the specifications are the deliverables (§4.3), changes to `requirements.md`, `design.md`,
or `tasks.md` follow the same pull-request and review path as code, and additionally:

- A requirement change names the acceptance criteria added, changed, or removed.
- A design change that adds, removes, or alters a property updates the property↔test mapping in the
  same pull request — the invariant that **each of Properties 1–36 has exactly one test** is never
  allowed to break across a merge.
- A task change that alters the dependency graph updates the wave JSON in `tasks.md`.

### 8.9 Defect tracking

Defects are filed as repository issues with a severity, the requirement group affected, and a
reproduction. Severity drives the response:

| Severity | Definition | Response |
| --- | --- | --- |
| **S1** | PHI exposure, silent alert loss, or a wrong adherence/missed-dose result | Stop the line: fix before any feature work, and add a property test reproducing it |
| **S2** | A requirement group's acceptance criterion is unmet | Fix within the current wave |
| **S3** | Cosmetic or non-blocking | Scheduled into the Week 14 hardening buffer |

A defect that a property test could have caught is closed only once that property test exists.

---

## 9. Plan Maintenance

This plan is a controlled configuration item under §8.1 and is revised the same way the
specifications are: by pull request, with review. Amendments are made when the process actually
changes — never retroactively to make a missed milestone look met. Every amendment is summarized in
the next status report (§7.3, item 5), and the plan's version history lives in
`git log -- docs/sdp.md`.

The PM reviews this document against actual practice at each iteration review. If practice has
drifted, the team decides at that meeting which of the two to change — and then changes it.

---

## 10. Summary

MMS is built by a small team against a written specification, in two-week iterations aligned to the
dependency waves already enumerated in `tasks.md`, with every area of the system owned by a named
member and every deliverable owned by a named role. The methodology serves two project-specific
facts: the riskiest logic is time math, which is cheap to specify and expensive to discover, so it
is specified and property-tested; and the course grades documentation, so the documentation is
authored as the specification the code follows rather than as a separate end-of-term artifact.
Risks are tracked with triggers and contingencies rather than intentions, communication has a
defined cadence and a defined escalation path, and configuration management keeps `master` green,
secrets and derived artifacts out of the repository, security-sensitive changes double-reviewed,
and every graded milestone reproducible from a tag.
