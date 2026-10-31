---
name: iobroker-project-maintenance
description: 'Develop, maintain, debug, test, review, and release ioBroker adapters. Use for adapter-core lifecycle, objects and states, ack semantics, roles, configuration, JSON Admin UI, messaging, Compact Mode, repository compliance, tests, CI, dependencies, and publishing.'
---

# ioBroker Adapter Development and Maintenance

Use this skill when an AI agent designs, implements, fixes, tests, reviews, or releases an ioBroker adapter. Learn the ioBroker platform conventions first, inspect the actual repository second, and choose solutions appropriate to that adapter. **Do not assume application-specific logic, minimum versions, UI technology, or feature requirements are universal.**

## Working Rules

- Inspect the target repository before proposing or editing anything. Read its agent instructions, `package.json`, `io-package.json`, `README.md` (or note if missing), changelog files, release configuration, workflow files, relevant source/tests, and current `git status`.
- Preserve user changes. Do not revert unrelated or pre-existing modifications.
- Treat bot output as a snapshot, not ground truth about the current checkout or live services. Compare every finding with the local files and, when needed and available, current npm/GitHub state.
- Distinguish repository-fixable findings from external or historical facts. Local files can fix configuration and metadata; npm provenance, published versions, GitHub releases/tags, merged PRs, and workflow run outcomes need corresponding registry or GitHub actions and may require permissions.
- Make the smallest scoped change that fixes the root cause. Validate the changed slice immediately and run the repository's required gates.
- Never invent maintainer information, release history, test results, or external status. If a finding cannot be verified, say so.

## Delegated Development and Orchestration

- For code implementation tasks, assign implementation to at least one subagent. Use multiple subagents only when work can be divided into genuinely independent parts or parallel validation is useful; avoid overlapping edits.
- The main agent owns the task: define scope and acceptance criteria, write bounded subagent prompts, coordinate work, resolve conflicts, inspect and integrate changes, run verification, and report results. Never treat a subagent's completion message as proof that its changes are correct.
- Keep implementation and final review independent: the subagent that implements a change must not be its sole reviewer. The main agent remains accountable for the final diff and all GitHub actions.

## Authoritative References and Decision Order

- **Start with current official sources**, particularly [Adapter Development](https://www.iobroker.com/docs/dev/adapterdev.md), [Adapter Reference](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterref.md), [io-package.json](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/iopackage.md), [State Roles](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md), [Best Practices](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/bestpractices.md), [Adapter Testing](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adaptertesting.md), and the [Repository Review Checklist](https://github.com/ioBroker/ioBroker.repositories/blob/master/REVIEW_CHECKLIST.md).
- For Admin UI details, use the maintained [JSON Config reference](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig) and, if relevant, the [custom-component template](https://github.com/ioBroker/ioBroker.admin-component-template). For releases, consult [Publishing Adapters](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterpublish.md).
- If a published guide and the actual installed adapter-core/controller/Admin versions disagree, verify the API and supported range in their corresponding package docs, types, release notes, and tests. Do not invent a new ioBroker rule from a single example or old blog post.
- Distinguish **mandatory repository requirements**, **recommended best practices**, **project conventions**, and **optional architectural choices**. Report which source or test supports each non-obvious assertion.

## Mandatory Pre-Release Repository Checker Gate

**This is a mandatory, proactive Terminal check only when creating an actual release—not when creating, updating, reviewing or merging a pull request.** Immediately before executing the approved release process (including its version tag and/or npm publication), the AI agent must run the official [ioBroker Repository Checker](https://github.com/ioBroker/ioBroker.repochecker) against the **actual, pushed release candidate branch**. It checks the branch on GitHub, not the local worktree. Tests and GitHub Actions complement, but do **not** replace, this manual pre-release check.

1. **Identify the precise remote release candidate.** Determine the GitHub owner, adapter repository and branch intended for the actual release. If the release is prepared from a fork or a feature branch, use the **branch containing the candidate to be released**, not automatically the upstream target or `main`. Verify `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, the remote URL and the pushed branch HEAD (e.g. `git ls-remote <remote> refs/heads/<branch>`). Ensure the release candidate changes are **committed and available on GitHub**, and that the intended local HEAD matches the remote branch commit. The checker will **not** inspect uncommitted or unpushed changes. If the remote branch is not current, ask for or obtain authorization to push before checking; never push without authorization and never claim unpushed work was checked.
2. **Run the official checker manually via Terminal using its standard remote mode.** Supply the **actual** GitHub repository URL and **explicit** candidate branch; do not omit the branch, since that would select the repository's default branch:

   ```bash
   npx @iobroker/repochecker https://github.com/OWNER/REPO BRANCH
   ```

   Example: `npx @iobroker/repochecker https://github.com/OWNER/ioBroker.example release/candidate`. Do **not** add `--local`. For extra diagnostic output, optionally add `--debug`. If GitHub API rate limits interfere, consult the upstream `--env <file>` option with a **private** `GITHUB_TOKEN`; never print or commit credentials.
3. **Evaluate the complete output.** Record checker version, exact remote repository and branch, checked commit/HEAD where verifiable, command, date, exit status, error/warning/suggestion IDs and totals. A nonzero exit code, incomplete network access, wrong branch, or an unverifiable remote commit does **not** count as a successful gate—even if the final summary includes `OK`. Inspect individual findings rather than trusting a bot headline.
4. **Fix applicable findings, then recheck the updated remote branch.** Resolve genuine checker **errors**, review warnings and justify any intentionally accepted ones, and treat suggestions as optional unless official requirements say otherwise. Corrections must be committed and pushed **with permission** before the checker can see them; run the same remote-mode command **again** after the pushed changes. Do not adjust release tags, published versions, workflow branches or GitHub settings just to hide a checker artifact.
5. **Classify external or pre-publication findings accurately.** A missing tag for a version not yet released may be expected; an npm publication mismatch, GitHub repository setting or checker bug may require separate action. Document such cases and request explicit maintainer approval for any exception to the gate. **An explained exception is not a passed checker run.** Do not block solely on demonstrably expected pre-release conditions without considering the project's approval policy.
6. **Apply the gate only to actual releases.** Run before each authorized release. If code or documentation changes after a successful check but before release, re-run it against the updated pushed release branch. Do **not** make this checker a gate for ordinary PR creation, review, updates, merges, or branch pushes. If the terminal checker cannot run or the release branch is not yet on GitHub, report the release blocker and mark the gate **not verified**. Never create a release, tag or push solely because this skill says to run a check; follow the user's authorization boundaries.

**Release preflight report:** `source GitHub repo / release branch / remote HEAD | checker version and command | exit code | errors | warnings | explained exceptions | recheck result | release-ready?`. The ioBroker repository bot and CI are additional, independent verification, not substitutes for the proactive remote check.

## Mandatory README Documentation: English

**Project policy for every adapter maintained with this skill:** Keep the English `README.md` current **in the same PR as the relevant change**. Do not merge a change with missing or inconsistent documentation.

1. **Inspect before editing.** Read the existing `README.md` and any linked `docs/` pages or historic changelogs. Preserve the adapter's established structure, useful usage examples, authorship, copyright, licenses, badges and links. Repair materially outdated or missing documentation within the scope of the change.
2. **Document what actually changed.** For new or modified functionality, configuration options, states, roles, supported providers/devices, permissions, dependencies, minimum runtime requirements, limitations, migrations, breaking changes, user-visible bug fixes or installation/setup steps: update the affected sections in `README.md`. Explain what users must do, not merely which source files changed. For internal-only changes affecting the next release, a brief collective changelog note is sufficient; do not claim a user-facing feature was added.
3. **Keep the README in English.** Preserve exact state IDs, commands, API names, configuration keys and URLs. Keep tables, steps, caveats and examples accurate; do not invent behavior.
4. **Update the changelog with every relevant PR.** Under `## Changelog`, accumulate **unreleased** entries in `### **WORK IN PROGRESS**` (or the repository's explicitly configured equivalent) in `README.md`. Keep entries **short and outcome-focused**, usually a few words or a single sentence. **Do not list every commit, file, refactoring step or small fix individually.** Group related changes or multiple PRs under one meaningful summary; merge or simplify accumulated notes before a release. Describe the relevant improvement/fix rather than implementation details. Mention breaking changes, migration steps or required user actions clearly even when the summary is brief. Add to the existing section rather than creating duplicate `WORK IN PROGRESS` headings. Keep released versions and dates intact; do not place unreleased work under a previously published version. If the adapter stores older history in `CHANGELOG_OLD.md` or another file, maintain links from `README.md` and keep old history unchanged except for a deliberate, verified migration.

**Changelog entry format:** Follow the repository's established author attribution and formatting; do not invent a maintainer name. When making changes through this user's account, prefix every new or updated changelog bullet with the exact text `- (Voodoo2man) `. Write new release notes in the **past tense** to describe completed work. Keep entries brief and outcome-focused, grouping related changes where appropriate. Do not rewrite unrelated historical entries solely to normalize formatting. For a truly docs-only change, do not fabricate a code-change changelog entry.

Use the repository's own attribution format in examples and release notes.

5. **Let the release script manage `io-package.json` release notes.** This repository does **not** use a `common.news.NEXT` entry. Do **not** manually add or update `common.news` for ordinary unreleased changes; keep those notes in the README's `WORK IN PROGRESS` section. The configured release script creates the versioned `common.news` entry during a release. After an authorized release-script run, verify its generated entries, required translations and schema validity. **`io-package.json` → `common.news` must contain at most 7 versioned entries; there is no `NEXT` entry.** If release tooling adds a new entry, retain the newest relevant versions and remove the oldest keys as appropriate; preserve their history in the `README.md` changelog (or linked archive files). Avoid contradictory entries and do not bypass schema/checker failures.
Language requirements, release-script behavior and maximum news-entry counts vary between adapters; verify this repository's configured tooling and treat these values as workspace-specific, not ioBroker-wide invariants.

6. **Check documentation quality.** Verify README links and Markdown rendering, screenshots/paths, commands, configuration examples, minimum-version claims, and consistency with code/tests and with `io-package.json`. Avoid recommending manual adapter installations that conflict with current ioBroker repository guidance. Check that copyright/license statements remain correct. Treat outdated descriptions as PR review findings, not post-release cleanup.

**PR documentation gate:** Before seeking PR approval, confirm that relevant README sections and concise changelog summaries are current, repository-specific author formatting is followed (including the required prefix for changes through this user's account), `common.news` was not manually changed for unreleased work and will be managed by the release script, links are valid, and documentation matches the implemented behavior. For a truly docs-only change, avoid fabricating a code-change changelog entry.

## Pull Requests, Version Numbers, and Unreleased Changes

**Versioning rule:** An ordinary feature, fix, refactoring or documentation PR is **not a release**. Do **not** automatically increase a version, create a Git tag, publish to npm or mark an unreleased changelog as released merely because a PR is opened or merged. This is a deliberate workflow rule of this skill, not a claim that all ioBroker repositories enforce the same merge strategy.

1. **Verify released state first:** Compare `package.json.version`, `io-package.json.common.version`, relevant lockfile root metadata, git tags, GitHub Releases and published npm versions/dist-tags. Both adapter version fields must agree. Check the repository's documented release strategy before changing any of them.
2. **Ordinary PR:** Keep the current version unchanged in both files and the lockfile (except justified dependency lock changes). Document the change briefly under `WORK IN PROGRESS` in `README.md` (group related changes where useful). Do not manually update `common.news`; the release script manages release news. Never repurpose an existing published version number to label new changes.
3. **Release-preparation PR (only when explicitly requested):** A release-specific PR may contain a coordinated version bump if the repository's actual process requires it. In that case, version fields, lockfile, release notes, tag strategy and changelogs must remain coherent. Never create a tag or run a publish-capable release script within an ordinary PR without explicit authorization; such scripts can commit, tag, push and trigger publication.
4. **Choose the future release increment using SemVer:** `patch` for backwards-compatible fixes, `minor` for backwards-compatible features, `major` for breaking changes. For 0.x releases, check the project's pre-1.0 convention; the release level is decided for the **combined changes actually being published**, not separately for each PR. A PR title or number is not an adapter version.
5. **Before any GitHub upload:** Before pushing a code branch, creating a PR, or otherwise uploading source changes, run the applicable tests, type checks, lint, build, and package checks for the final diff. Review the output; configured CI does not replace local validation. Do not upload code with failing or unrun required checks unless the user explicitly authorizes a documented exception.
6. **Independent review is a required pre-upload gate:** Assign a fresh subagent that did not implement the change to review the final diff, relevant tests, and documentation. It must check correctness, regressions, test gaps, and compatibility, and report actionable findings. The main agent must triage every finding, fix confirmed issues, rerun relevant checks, and obtain an independent review of the updated diff after substantive fixes. Do not push or create a PR while blocking findings remain or the independent review/checks are incomplete. A passing CI run or implementer self-review does not replace this gate.
7. **Authorization and checker scope:** Review gates do not grant permission to push, create or merge a PR; obtain normal user authorization for GitHub operations. The Repository Checker is not required for PRs; it runs only for actual releases as described above.

## Release Procedure (Only When Explicitly Authorized)

**Do not interpret 'PR ready', 'prepare release' or a successful Repository Checker as permission to publish.** An actual release, Git tag, push, npm publication or change to the official ioBroker latest/stable repository requires the relevant explicit authorization and rights. Follow the adapter's installed release tooling rather than assuming every repository is identical. Official background: [Publishing Adapters](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterpublish.md).

1. **Establish the release baseline.** Confirm the authorized target repository/branch, intended version, current npm/git release state, clean or accounted-for worktree, and absence of conflicting release jobs. Determine whether the project uses `@alcalzone/release-script` and `.releaseconfig.json` or a different workflow. Inspect `package.json` scripts and GitHub deploy workflow; determine precisely which commands can **modify files, commit, tag, push or publish**. Never run these during inspection.
2. **Freeze the release contents.** Ensure the intended PRs are merged or are part of the release candidate. Review the `WORK IN PROGRESS` notes since the last release; **combine related items into a small number of short, informative release summaries** rather than publishing a commit-by-commit account. Verify `README.md` accurately describes final behavior, required user actions, breaking changes and updated minimum requirements. Follow the repository's changelog attribution and tense conventions; for changes through this user's account, ensure each new or updated bullet starts with `- (Voodoo2man) `. Ensure README changelog and `common.news` use the required languages and describe the shipped scope consistently. Respect any repository or checker limit on `common.news` entries and preserve older history in the README changelog or linked archives.
3. **Select and validate the next version.** Determine patch/minor/major (and prerelease channel, if any) from the actual changes and project conventions. Check that the target version has **not** already been published/tagged. Before publication, `package.json.version`, `io-package.json.common.version` and appropriate root lockfile metadata must match; do not bump these independently when the configured release script performs this step. Release tooling may convert `WORK IN PROGRESS` and generate the matching versioned `common.news` entry; **verify the resulting `README.md` and `io-package.json`** and correct them if the tooling does not update them as expected. Do not introduce a `NEXT` news entry.
4. **Run pre-release verification.** Execute the applicable repo scripts (`npm ci`, lint, checks, build, unit/package/integration tests) in an appropriate environment, and inspect `npm pack --dry-run` plus workflow/CI status. Run the **mandatory manual Repository Checker from Terminal against the exact pushed release candidate branch**, without `--local`, shortly before release. If the script changes files/commit afterward, run the same checker against the updated pushed candidate before any tag/publication if the process permits; never claim a pre-change check covered different commits.
5. **Execute the configured release workflow only with approval.** For a repository with a verified `release` npm script based on the documented ioBroker release tooling, the usual invocation is `npm run release -- patch`, `npm run release -- minor`, or `npm run release -- major` (choose **one**). Confirm the script's actual argument syntax and dry-run/review options beforehand. It may automatically update versions/changelogs/`common.news`, create a release commit/tag and push; it must not be run speculatively. If the repository uses another process, follow that process instead. **Do not manually create duplicate tags or run `npm publish` when tag-triggered CI already publishes.**
6. **Check artifacts and deployment.** Verify the final Git commit and tag point to the intended code, the README changelog has the correct released-version heading and date and follows the repository's attribution convention, `io-package.json.common.news` contains the intended release entry and translations within any applicable entry limit, package contents are correct, and GitHub Actions deployment succeeds. Verify that the **exact version** appears on npm with the expected dist-tag and, where configured, valid trusted-publishing provenance. A green build is not proof that npm publication succeeded; a Git tag is not an npm release.
7. **Handle failure without rewriting history.** Investigate the exact failed job/log or npm state. Do not force-push, move/reuse published tags, overwrite a published npm version or retry a publication blindly. Fix the cause, choose the next valid version if needed and re-run the authorized checks. Follow the repository's release/recovery policy.
8. **Separate adapter publication from repository promotion.** Publishing an adapter to npm **does not** automatically add it to ioBroker Latest or Stable. Follow the separate [ioBroker repositories](https://github.com/ioBroker/ioBroker.repositories) procedure (tests/user feedback, required listing PRs and stable-version selection). Never silently edit those repositories or claim promotion without confirmation.

**Release report:** `approved version and SemVer rationale | source branch/commit | README.md and changelog | common.news translations | tests/build/package | remote checker and exit code | generated commit/tag | GitHub deploy workflow | npm exact version/dist-tag/provenance | ioBroker Latest/Stable status | blockers/next action`. Mark every unverified external step explicitly as **not verified**.

## ioBroker Platform Fundamentals

- An **adapter** is an npm package; an **instance** is a configured running copy, e.g. `example.0`. Several instances of the same adapter can coexist. Instance data and identifiers must not leak between them.
- The object tree contains metadata and structure: `device`, `channel`, `state`, folders and adapter/instance objects. A **state's object** defines its `common` metadata; its **state value** holds data and attributes such as `val`, `ack`, `ts`, `lc`, and potentially quality information. Never confuse an object update with a state-value update.
- Local IDs passed to the instance API are relative to its namespace where the method specifies local IDs; *foreign* APIs work on fully qualified IDs such as `otherAdapter.0.device.value`. Check the exact method contract rather than concatenating namespaces blindly.
- Arrange device/channel/state parents coherently. Create or verify parents before creating nested states. Prefer stable, documented IDs; changing an ID is a compatibility migration, not cosmetic cleanup. Only delete objects the adapter owns and only when ownership is provable.
- Use `this.config` for instance `native` settings. Treat `io-package.json` `native` values as defaults, not a substitute for validating an actual runtime configuration.
- ioBroker coordinates via js-controller, while adapters normally use `@iobroker/adapter-core` and its public APIs. Do not manipulate ioBroker's backing object/state databases directly from normal adapter code.

### State Object Metadata: Type, Role, Access, Unit

- Every generated state needs coherent `common.type`, `common.role`, `common.read`, and `common.write`; add `common.unit`, `min`, `max`, `step`, `states`, and human-readable/localized names as applicable. Distinguish the **value type** (`number`, `boolean`, `string`, etc.) from the **semantic role**.
- Choose the most specific **valid** role from the *current* [State Roles reference](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md). Typical patterns: read-only numerical `value.*`, writable numerical `level.*`, read-only boolean `sensor.*` or `indicator.*`, writable `switch.*`, JSON serialized as a **string** with role `json` if that fits the actual schema.
- A momentary write-only action may use `role: "button"`, `type: "boolean"`, `read: false`, `write: true`. **Do not blindly substitute `button.press`**: it is also documented for a distinct read-only button-as-sensor pattern. The chosen role and access flags must describe the actual interface.
- Units belong to the physical quantity: e.g. temperatures, power, energy, percentages, and their derived values. Do not apply a source unit to dimensionless ratios or percentages unless mathematically correct. Be consistent between object metadata, UI labels and emitted values.
- Use ioBroker's supported translation representation for generated `common.name` (and `common.desc` where applicable). Avoid overwriting user-customized object names/units during routine restarts; when metadata must be migrated, do so deliberately and test the existing-installation path.
- Null, zero, `false`, empty string and absence are different states. Never invent `0` or re-use a stale measurement to conceal missing data. Match values written to the declared type and platform's permitted null semantics.

### State Changes and `ack`

- In the common command pattern, `ack: false` means **requested/unconfirmed**; `ack: true` means the adapter has **confirmed/reported** the value. Output/feedback states created by the adapter should normally be written with `ack: true`.
- For a state that accepts commands, explicitly decide what to do with `ack: false` events, validate command payloads, perform/queue the operation, then acknowledge/report the result as appropriate. Do not reprocess your own acknowledged feedback and create command loops.
- For measurements from **foreign** states, honor the source's contract: an unacknowledged setpoint/command is not automatically a confirmed measurement. Avoid blindly learning from `ack: false` unless the monitored adapter's semantics explicitly justify it.
- `stateChange` can receive `null`; guard it. `state.val` can be `0` or `false`, so never use truthiness as a validity check. Validate type, finite numbers and timestamps explicitly.
- `ts` means last state-write time, `lc` means last change of value. Do not use them interchangeably. A newly delivered event need not represent a newly changed value; choose whether the algorithm cares about writes, changes, freshness, or commands.
- Subscribing does **not** automatically deliver the initial state. After subscribing, explicitly read the current local/foreign state when the feature needs a startup snapshot. Handle events arriving between registration and the initial read; avoid losing fresh events or processing older values after newer ones.
- Treat duplicate/out-of-order events deliberately. Where order matters, apply per-source queues, monotonic timestamps or sequence IDs; retain repeated same-value observations when they are meaningful, such as heartbeat or event counting.
- Use `setStateChangedAsync` (if supported by the target API) when only a changed value matters; use normal state writes where the write event and timestamp themselves are meaningful. Do not optimize away required events.

## Adapter Lifecycle and Asynchronous Work

- Use the generated framework's lifecycle rather than inventing a global process. In class-style TypeScript/JavaScript adapters, wire `ready`, `stateChange`, `message`, `objectChange` (if needed), and `unload` to instance methods; inspect how the specific project registers them.
- In `ready`: validate configuration; create/verify owned objects; prepare connections and other resources; register subscriptions/listeners; establish a consistent initial snapshot; begin timers/polling; update connection/health states. Check for shutdown during long asynchronous startup.
- In `stateChange`/`objectChange`: handle only subscribed, relevant IDs, validate values, and keep callbacks lightweight. Catch/report rejected promises; avoid unbounded overlapping work caused by bursty updates.
- In `message`: use the official inter-instance messaging APIs. Set `common.messagebox: true` when the adapter must receive `sendTo` requests; validate command and payload, use the received callback for responses, and do not expose secrets in replies. Provide useful timeout/error behavior to callers.
- In `unload`: **stop accepting work first**, clear all adapter-owned timers/intervals, abort or close requests and external connections, remove listeners/subscriptions where required, finish or safely cancel pending tasks, then invoke the supplied callback **exactly once**, even on errors. Check how much shutdown time the controller allows. Compact Mode makes leaked timers/listeners particularly costly.
- Prefer lifecycle-managed timer helpers (`this.setTimeout`, `this.clearTimeout`, etc. where supported) and explicitly track every long-lived resource. Avoid background jobs that survive a stopped instance.
- Serialize mutable work **per entity** when operations must be ordered; allow independent entities to work concurrently. For persistence, create the snapshot *inside* the serialized write task so an older queued snapshot cannot overwrite newer state.
- Treat `Promise.all` fail-fast semantics carefully: rejection does not cancel sibling promises. If subsequent batches must not overtake still-running siblings, settle all launched work before advancing, while preserving error reporting.
- Bound memory, queues, concurrency, reconnection retries and provider/network requests. Use backoff, timeouts, cancellation signals, and limits when a dependency can hang or return unbounded data. Do not silently swallow errors.
- Persist data at a safe cadence and during orderly shutdown where appropriate. Never persist partially initialized empty structures over valid saved data during failed/aborted startup. Protect existing data from malformed or incomplete replacement inputs.
- **Compact Mode** (`common.compact`) is not merely a metadata flag: an instance may run inside a shared controller process. Avoid `process.exit`, process-global mutable state, and resource leaks; explicitly test start/stop/restart of one instance while another continues.

## Configuration, Admin, and User Experience

- Prefer `admin/jsonConfig.json` or JSON5 for ordinary settings when supported by the project's required Admin version. Use `common.adminUI.config: "json"` with the correct file. Bind controls to the intended `native` configuration fields; verify defaults, types, conditional visibility, validation, and list/table behavior.
- Use custom Admin components only when interaction requirements justify them, e.g. complex visualization or asynchronous selection. Follow the current official custom-component template and API version (`guiApi`) rather than copying an incompatible React/MUI example.
- Verify that generated Admin bundles, module-federation manifests, entry scripts, translations and dynamic assets **are included in the npm package**. A successful source build does not prove that the published package will contain or load them.
- For asynchronous Admin requests, handle loading, errors, empty results and retries. Older in-flight responses must not overwrite newer selections or a different adapter instance. Invalidate callbacks after component teardown, and avoid state updates after unmount.
- Translate displayed strings and dynamic object names into the languages supported/required by the adapter. Check identical translation keys and meaningful fallbacks. Do not assume one specific language set is always mandatory without checking the current project and repository policy.
- Keep credentials protected in config, logging, messages and exported diagnostics. Choose the current ioBroker credential/encryption facilities rather than implementing homemade storage or embedding keys in Admin assets.

## Data Ingestion, External APIs, and Local Persistence

- Normalize and validate untrusted device/API payloads *before* writing states or updating internal models: type, units, ranges, finite numeric values, time zones, timestamps, nulls, duplicates, and ordering. Preserve a clear distinction between unavailable data and actual zero/false values.
- Prefer change- or event-driven subscriptions when supported; for polling, choose a configurable sensible interval, avoid duplicate cycles and clear timers on unload. Reflect connectivity/health accurately, not optimistically.
- If consuming History/SQL/other providers, check the exact response shape, state identifier, time range, ordering, pagination/limits and message protocol. Never assume one provider's response semantics apply to another. Validate every returned record and guard against truncated pages, duplicate timestamps, gaps, oversized payloads and service outages.
- If the adapter stores durable data, version and validate its serialized format, test loading old versions and partial corruption, and handle migrations without resetting unrelated valid records. State/ID/schema changes need explicit compatibility plans.
- Use `dataFolder` or other documented ioBroker storage APIs when appropriate; avoid writing into installation paths and mutating unrelated adapters' namespaces.

## Testing and Debugging Fundamentals

- **Unit tests:** isolate parsers, transforms, validation, queue ordering, retry/timeout logic and value-to-state mapping. Include boundaries: 0, false, null, empty, invalid and extreme numbers, duplicate/out-of-order timestamps, partial failures, and shutdown races.
- **Package tests:** use the project's `@iobroker/testing` package checks and schemas. Verify metadata, roles/types/units, parent objects, translation completeness and required files. A schema pass is not a functional test.
- **Integration tests:** start the adapter through `@iobroker/testing` or an equivalent real test harness; use actual objects/states and subscriptions. Test command `ack`, initial values, asynchronous message callbacks, state creation, disabled/missing configuration, restart, persistence, and a clean stop. Fake external devices/providers at a well-defined boundary; don't fake ioBroker semantics away.
- **Compact Mode tests** (when claimed): verify startup, stop and restart within a shared controller process with another instance alive; confirm no leaked event processing, timers or listeners after stopping the first instance.
- **Admin tests:** test request races, responses/errors/empty states, translations and packaging; for custom UI, also run a real browser-based smoke test against the **minimum supported Admin version** when possible.
- **Compatibility:** test the project's declared minimum Node.js/controller/Admin versions as well as representative current versions. CI matrix selection must match declared support; stable and prerelease controller results are not interchangeable. Linux-only success is not proof of Windows/macOS support.
- **Tests do not run themselves.** Read `package.json` scripts before using `npm ci`, `npm test`, `npm run check`, `npm run lint`, `npm run build`, package/integration/admin commands. Install Admin dependencies before invoking Admin tests where separate lockfiles are used.
- **Official GitHub Actions:** consult the documentation and `action.yml` for the exact version used in the repository before changing workflow inputs or defaults: [testing-action-check](https://github.com/ioBroker/testing-action-check), [testing-action-adapter](https://github.com/ioBroker/testing-action-adapter), and [testing-action-deploy](https://github.com/ioBroker/testing-action-deploy). In particular, verify whether a build is enabled by default and whether this adapter actually has a build step; do not infer action behavior from another workflow or version.
- After builds, inspect `npm pack --dry-run` and referenced asset paths; check if build steps regenerate tracked files and clean up only changes you created. For a regression, prefer a failing test first, then a focused fix, then full checks.
- Distinguish **static review**, **a reproducible isolated test**, **executed unit tests**, **real integration tests**, **manual UI verification**, **CI**, and **production behavior**. Never call something "passed" because it is configured or because a repository document claims it passed.

## Audit, Dependency, and Security Reasoning

- Use `npm audit` and `npm audit --omit=dev` (and the equivalent for a separate Admin package), where appropriate and network access exists. An audit exit code of 1 is **not** a pass. Record actual package versions, advisory identifiers, dependency paths and available upstream patches.
- One advisory can mark multiple parent packages; distinguish *affected package counts* from *independent vulnerabilities*. Analyze whether the vulnerable functionality is reachable rather than treating every transitive warning as an exploitable adapter bug—or dismissing it merely because the adapter never imports that package directly.
- Avoid blind `npm audit fix --force`, uncontrolled dependency-major upgrades, security-tool suppression and version changes solely to silence a checker. Propose tested, compatibility-aware fixes or document accepted upstream risks.
- Bot and repository checker results require classification: an unpublished version missing a tag, an external npm state, a local-checker path quirk, and a real metadata error are different classes. Check exit codes, actual output, current branch and remote default branch; never treat a reassuring summary as success if the process failed.

## AI Agent Review and Delivery Contract

1. **Scope:** Identify the requested change or audit and the actual branch/HEAD, dirty files, supported runtime versions, and release restrictions. Never operate on `main` or publish unless instructed.
2. **Evidence:** Inspect the relevant source and tests. Reproduce suspected defects with a minimal case; distinguish confirmed bugs from plausible but untested risks and optional improvements. Re-check findings after new commits rather than repeating stale ones.
3. **Implementation:** Make small, reviewable changes; update `README.md` and its unreleased changelog in the same PR. Preserve stable IDs, `native` fields, data formats, user-customized objects and public messages unless migrations are explicitly required. Add focused regression tests.
4. **Verification:** Verify README content, changelog and release-note consistency and run available tests, lint and package checks for PRs. **Run the mandatory manual Terminal Repository Checker only for an actual release**, as defined in the pre-release gate above; capture commands, versions, exit codes, test counts and CI URLs as applicable. Do not claim tests across Node/OS/controller versions without having run them. Where execution isn't possible, state precisely what was inspected.
5. **Report:** Give a clear severity/risk ranking with file locations, trigger conditions, impact, proof, fix and tests. Separate functional correctness, ioBroker compliance, security, compatibility, packaging and release readiness. A proposed PR can be review-ready without being safe to merge or release.

### Code Efficiency and Minimal Complexity

For every code review, critically assess whether the implementation is the simplest, most efficient, and most robust solution to the requirements. Evaluate:

- **KISS, DRY, and YAGNI:** Is the solution as simple as possible, does it avoid duplication, and does it exclude functionality that is not currently needed?
- **Overengineering and code size:** Are there abstractions, wrappers, classes, helper functions, or lines of code without concrete value? Could the same result be achieved as well or better with less code?
- **Performance:** Are CPU, memory, network, and I/O used efficiently?
- **Native functions and existing project code:** Could custom implementations be replaced with standard-library features or existing project functions?
- **Maintainability:** Is the code immediately understandable, clearly structured, and maintainable over time?

Question the actual value of every abstraction and additional layer of code. Assess not only whether the code works, but whether it needs to exist in this form. Suggest simplifications only when they offer a concrete benefit without degrading functionality, stability, security, or readability. Distinguish proven improvements from theoretical optimization opportunities.

**Guiding principle:** Use as little code and complexity as practical, and as much as necessary.

## Triage ioBroker Check Reports

For each reported item, classify it as:

1. **Current and locally fixable**: confirm against the checkout, then edit the owning file.
2. **Already fixed locally or report is stale**: cite the exact file/config evidence; do not duplicate the fix.
3. **External state**: verify against npm or GitHub if authenticated/network access exists; otherwise explain the required owner action.
4. **Optional suggestion**: assess compatibility and project policy before adopting; do not treat suggestions as errors.

Check common report groups as follows:

- **ESLint config**: confirm `eslint.config.mjs` imports the installed `@iobroker/eslint-config` package rather than copying a stale template.
- **Adapter metadata and changelog**: compare `common.version` in `io-package.json` with `package.json` version. Ensure current release news exists for supported languages, **`common.news` has at most 7 versioned entries and no `NEXT` entry**, and historic changelog files are linked from `README.md`. Do not delete news or change versions solely from an old bot report; first verify actual published history and release policy.
- **README/copyright**: confirm `README.md` (English) exists, accurately documents current functionality, and has working historic changelog links, and copyright email is a valid address already established by repository metadata (for example `package.json` author). Do not guess an address.
- **Release-script config**: if release-script is used, verify `.releaseconfig.json` exists and matches installed plugins and scripts.
- **YAML/workflows**: verify the named files exist and are non-empty, parse as YAML, and reference valid action versions. Inspect current workflow runs and job logs before diagnosing a failure. A failed, cancelled, or superseded historical run does not prove the current branch/tag is failing.
- **npm and GitHub releases**: compare npm `latest`, package version, git tags, GitHub Releases, and provenance independently. A Git tag does not itself prove npm provenance. Trusted publishing requires compatible workflow permissions/configuration and setup on npm; do not claim it is enabled based only on a workflow comment.
- **Dependencies**: check the installed and lockfile versions before updating. Determine whether apparently unused runtime dependencies are required by generated/runtime tooling before removing them. Avoid arbitrary dependency churn.
- **TypeScript and VS Code**: follow the repo's TypeScript base config and add schema mappings for ioBroker metadata/Admin JSON only when missing and appropriate.
- **Ignore rules**: check for generated files such as `.commitinfo` and ensure they are ignored where required.
- **Dependabot**: validate configuration against current Dependabot capabilities. Cron schedules, cooldowns, PR limits, and auto-merge are policy choices; preserve security protections and do not auto-merge untrusted code.
- **Repository and adapter listing**: publication in the ioBroker repository list may be pending external PR/review; do not claim an adapter is listed without checking.

## Repository Discovery and Validation

1. Read repository instructions and inspect the relevant configuration/test surfaces. Use targeted searches, not a broad rewrite.
2. Record the current branch, commit, and worktree status before edits.
3. For a bot report, make a compact checklist mapping each finding to local evidence or the external verification needed.
4. Check available scripts in `package.json`; do not assume every adapter uses identical scripts. Common checks include:
   - `npm test` for unit and package tests when defined.
   - `npm run check` for TypeScript checks when defined.
   - `npm run lint` for linting when defined.
   - `npm run build` for adapter/Admin builds when defined.
   - integration or adapter tests only when their environment is available and appropriate.
5. After edits, run the narrowest relevant check first, then the required broader checks. Report commands that could not be run and why.
6. **Before an actual release only**, execute the Repository Checker manually in the Terminal against the pushed release candidate branch as specified in the mandatory gate above; rerun after authorized changes and report its exit code. **Do not run or require it as part of PR creation or review.** For other external checks, use the repository's configured remote and canonical package name. If `gh` is available, inspect workflow runs, releases, tags, and issue/PR state. If npm is available, check the exact package and version; avoid confusing similarly named packages.

## Common ioBroker Repository Patterns

These are useful starting points, not mandatory rules; confirm them against each adapter's conventions and current ioBroker tooling:

- Adapter identity/version/news are commonly maintained in `io-package.json`; npm identity, scripts, dependencies, author and packaging metadata are in `package.json`.
- Modern JavaScript/TypeScript adapters commonly use `@iobroker/eslint-config`, `@iobroker/testing`, a Node TypeScript base such as `@tsconfig/nodeXX`, and release-script plugins. Use the versions and Node range supported by the actual repository and CI.
- Package validation may be exposed through `@iobroker/testing`'s `tests.packageFiles(...)`; use the existing test harness rather than inventing a duplicate.
- A release configuration may define release-script plugins and pre-commit build behavior. Confirm whether this is appropriate for the repository before creating or changing it.
- GitHub Actions should use maintained, versioned action refs where upstream supports them. Keep Node versions consistent with adapter requirements and dependencies. Matrix OS/Node coverage should be based on supported runtimes.
- VS Code JSON schema associations can improve editing for `io-package.json` and Admin JSON configuration; schema URLs can move, so verify current upstream paths before adding new mappings.
- Admin UI architecture depends on the workflow. Standard JSON config is a good fit for ordinary settings; custom React/Admin UI can be justified for interactive search, asynchronous validation, selection, or complex result/error states. Keep adapter network/business logic out of the UI where the project architecture allows.
- Use tests around adapter-specific behavior and migrations, especially when changing object IDs, state metadata, translations, lifecycle handling, or persisted-object compatibility.

## Lessons from TypeScript Packaging and Releases

These lessons came from an adapter migration and release workflow. Verify each repository's actual tooling and installation contract before applying them; they are not universal requirements.

- A TypeScript migration must align source files, compiler output, `package.json.main`, package `files`, tests, and deployment. A successful typecheck alone does not prove the emitted runtime entry point is present in the published package.
- Determine whether installations use npm packages, Git checkouts, or both. If generated output is intentionally absent from Git, check whether `common.nogit` is appropriate for the adapter/controller versions in use and ensure the supported deployment path builds before packaging.
- Inspect the configured GitHub Action's inputs and implementation. A build input may default to disabled; explicitly enable it when required. Do not assume a generic test/deploy action builds TypeScript automatically.
- Avoid redundant builds. If deployment explicitly builds before publishing, `prepack` may run the same build again when npm packs the package. Keep a lifecycle hook only when it covers a real supported packaging path that CI/deploy does not cover.
- Do not use `prepare` as an automatic build workaround without checking ioBroker package validation and install modes; repository checks may reject it. Validate the actual Git/npm installation path rather than inferring it from local behavior.
- After an explicit build, use `npm pack --dry-run` to verify that `main`, runtime files, Admin assets, translations, and required generated files are included. A successful build does not guarantee correct tarball contents.
- The release script may require an exact changelog placeholder, a clean working tree, and the default release branch. Read the installed script's help and official documentation; run its dry-run first to expose the planned version, changelog, commit, tag, and push operations.
- A remote repository checker evaluates the pushed commit, not local state. When generated output is intentionally not committed, classify missing-source-file warnings against the chosen packaging model and independently verify the npm artifact and deploy build; do not dismiss unrelated findings on that basis.

## Release and CI Safety

- **Before PR creation:** confirm `README.md` and its unreleased changelog state and run the project's ordinary test/CI gates; the Repository Checker is **not** a PR gate. **Only before creating an actual release:** confirm the README changelog and release metadata, then run and review the official Repository Checker manually in standard remote mode against the pushed release candidate branch (no `--local`). Apply the mandatory pre-release gate above; neither a past bot result nor a configured CI job fulfills it.
- Do not create, move, or delete Git tags or releases without an explicit release task and verified version/changelog state in `README.md` and `common.news`. Ordinary PRs must not bump release versions or create tags.
- Before publishing, check that tests/build pass, package contents are correct, version metadata is aligned, and the intended tag points to the intended commit.
- For npm trusted publishing, verify npm's configured trusted publisher and the workflow's OIDC permissions. Confirm provenance on the published version after deployment.
- Treat release failures as observable evidence: inspect the failing job/log and fix the specific cause. Do not infer failure from old bot summaries when a newer successful run exists.
- Never claim external operations were completed unless the tool output confirms them.
