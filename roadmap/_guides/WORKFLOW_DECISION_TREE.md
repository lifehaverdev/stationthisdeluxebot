# Contributor Workflow Decision Tree

> **Goal**: Help any agent or human decide **where to document** and **how deeply to plan** before writing code.

```
Start
 ├─► 1. Identify the change you want to make
 │      │
 │      └─► 2. Estimate Scope
 │                │
 │                ├─► SMALL (≤ 1 file, <2 h) ─► go to A
 │                │
 │                └─► LARGE (>1 file, multi-step) ─► go to B
 |
 └─► 3. End
```

---
## A. Small-Task Workflow (Quick Fix / Minor Enhancement)
1. **Find the Module Row**  
   • Open `roadmap/master-outline.md`  
   • Locate the epic/module that owns the file you’ll touch.  
   • If missing, add a new module row under the relevant epic.
2. **Open Latest Sprint Folder**  
   `roadmap/<feature>/sprints/YYYY-MM-DD/` (create if absent).  
   Copy `_templates/SprintLog.md` → `SprintLog.md` (one log per sprint).
3. **Code & Commit**  
   • Make the change.  
   • Update the module **Status** to `Completed` or `In Progress` as appropriate.
4. **Create Handoff**  
   • Copy `_templates/Handoff.md` → `handoff-<date>.md` in the sprint folder.  
   • Summarise what changed and which files were touched.
5. **Open PR**  
   PR title `[roadmap:<epic>/<module>] <short description>`  
   Ensure checklist passes.

> **Tip**: No new ADR required for small tasks unless you made a design decision.

---
## B. Large-Task Workflow (Feature / Refactor)
1. **Create / Update Feature Outline**  
   • If the feature doesn’t exist: `mkdir roadmap/<slug>` and copy `Outline.md` template.  
   • If it exists, update acceptance criteria.
2. **Plan Sprint**  
   `mkdir -p roadmap/<slug>/sprints/<today>`  
   Copy `_templates/SprintLog.md`.
3. **Write an ADR**  
   Copy `_templates/ADR.md` → `adr-XXX-<slug>.md` inside the sprint folder.  
   Fill **Context**, **Decision**, **Consequences**; leave *Implementation Log* empty for now.
4. **Architect & Code**  
   • Update Implementation Log continuously.  
   • Keep module Status as `In Progress` until full acceptance criteria met.
5. **Test**  
   • Run unit/integration tests.  
   • Sanity-check the rest of the app.
6. **Handoff**  
   • Summarise changes, demos, screenshots in sprint folder.
7. **PR**  
   • Title tag uses the feature slug.  
   • Checklist: ADR + Status updated.

> **Tip**: Break extremely large features into multiple ADRs across successive sprints.

---
## Misc / Tools & Scripts
* **Misc-Small**: If a task spans many areas but is still <2h, place it under `roadmap/misc/sprints/<date>`.
* `scripts/update-status.sh` – CLI helper to bump module Status.
* `_historical/` – read-only past docs.  Migrate into sprints only when actively editing.

---
## Visual Cheat Sheet
```
Quick Fix  ─► SprintLog + Handoff → PR
      ▲
      │
Big Feature ─► Outline → ADR → SprintLog → Handoff → PR
```

Stick to this tree and our roadmap will stay accurate without slowing you down. 🎉
