# Roadmap Directory

This folder is the single source of truth for **StationThis** planning, documentation, and historical artifacts.

## Contents

| Path | Purpose |
|------|---------|
| `master-outline.md` | Enduring architecture & principles |
| `master-roadmap.md` | High-level goals and timeline |
| `_templates/` | Authoritative markdown skeletons for ADRs, handoffs, sprint logs, outlines |
| `<feature-slug>/` | Folder for an individual feature (spec, roadmap, sprints) |

## Workflow in Brief

1. **Create a Feature** — Add `<feature-slug>/outline.md` and `roadmap.md`.
2. **Plan a Sprint** — Inside `<feature-slug>/sprints/YYYY-MM-DD/` add `sprint-outline.md`.
3. **During the Sprint** — Store ADRs, handoffs, and demo artifacts in the same sprint folder.
4. **After the Sprint** — Update the feature `roadmap.md` and top-level `master-roadmap.md`.

For detailed conventions see the ADR *Feature-Centric Collaboration Model* (ADR-2025-08-21).
