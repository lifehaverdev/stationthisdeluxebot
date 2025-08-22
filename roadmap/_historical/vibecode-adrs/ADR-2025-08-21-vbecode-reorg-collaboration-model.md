> Imported from vibecode/decisions/adr/ADR-2025-08-21-vbecode-reorg-collaboration-model.md on 2025-08-21

# ADR-2025-08-21: Feature-Centric Collaboration Model (vbecode-reorg)

## Context
Our legacy `vibecode/` and `docs/` directories evolved organically while we completed the StationThis refactor.  As of 2025-08-21 the core overhaul is complete; the remaining work centers on discrete feature tracks (e.g., Telegram parity) and welcoming external open-source contributors.

The current documentation layout mixes high-level roadmaps, WIP sprint notes, ADRs, and handoffs in the same folders.  This obscures project status, complicates agent navigation, and discourages new contributors.

We need a single, predictable place where both agents and humans can:
1. Discover the big-picture vision
2. Drill into a specific feature’s goals, roadmap, and active sprints
3. Locate authoritative ADRs and handoffs without hunting through working directories

## Decision
We will introduce a top-level `roadmap/` directory structured as follows:

```
/roadmap
  README.md                # how to navigate this hierarchy
  master-outline.md        # enduring architecture / principles
  master-roadmap.md        # quarter / half-year goals, links to features
  _templates/              # canonical markdown skeletons
    ADR.md
    Handoff.md
    SprintLog.md
    Outline.md
  <feature-slug>/          # kebab-case (e.g. telegram-command-parity)
    outline.md             # long-lived spec & acceptance criteria
    roadmap.md             # rolling 3-6 month goals for this feature
    sprints/
      YYYY-MM-DD/          # ISO-dated sprint folder
        sprint-outline.md
        handoff-YYYY-MM-DD.md
        adr-<seq>-<slug>.md
        demo/              # screenshots / playwright tests / gifs
```

Key conventions:
- **Feature Folder**: kebab-case descriptive slug.
- **Sprint Folder**: ISO date (`YYYY-MM-DD`).
- **ADR Filename**: `adr-<seq>-<slug>.md`.
- **Handoff Filename**: `handoff-YYYY-MM-DD.md`.
- `_templates/` holds authoritative skeletons that agents copy programmatically.

Workflow changes:
1. New features start with `outline.md` + initial `roadmap.md`.
2. Each development iteration creates a dated sprint folder containing:
   - `sprint-outline.md` (goals, demo targets)
   - ADRs & handoffs generated during the sprint
   - `demo/` assets proving progress
3. Completed work bubbles up: feature `roadmap.md` and top-level `master-roadmap.md` are updated; sprint folders remain as historical record.

## Consequences
+ **Discoverability**: Contributors can grasp the entire project, then zoom into a feature without context-switching across directories.
+ **Agent Compatibility**: Autonomous agents rely on deterministic paths and templates, improving reliability of automated documentation.
+ **Open-Source Friendly**: Clear separation between architecture, feature specs, and sprint artifacts lowers the barrier to entry.
+ **Migration Requirement**: Existing materials in `vibecode/` and `docs/` must be migrated into the new hierarchy.
+ **Enforced Discipline**: Every sprint must conclude with an updated handoff and, where applicable, an ADR.

## Alternatives Considered
1. **Keep Current Layout** — Rejected: continues confusion; hard to onboard new contributors.
2. **External Documentation Site (e.g., GitBook)** — Rejected: introduces platform overhead; duplicates source-controlled truth.
3. **Monolithic `docs/` Tree by Document Type** — Rejected: separates roadmaps from their contextual features, forcing contributors to correlate across folders.
