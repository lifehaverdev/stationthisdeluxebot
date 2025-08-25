# AGENT COLLABORATION PROTOCOL – v3 (Roadmap Aware)

> **Purpose**: Provide a single onboarding reference for LLM agents and human contributors that aligns with the new `roadmap/` documentation hierarchy.

---

## 1  First 5 Minutes Checklist
1. Open `roadmap/README.md` – understand folder layout.
2. Read `roadmap/master-outline.md` – know epics & modules.
3. Read `roadmap/master-roadmap.md` – know current objectives & target dates.
4. Ask the user **which feature or module** you should focus on (_never assume_).
5. Navigate to that feature folder: `roadmap/<feature-slug>/`  
   • Review `outline.md`  
   • Open the latest sprint folder to see ADR / Handoff logs.

## 2  Working During a Session
| Step | Action |
|------|--------|
| 1 | Update Implementation Log inside the relevant ADR as you discover blockers or make decisions. |
| 2 | When you change code, also update the **Status** column for the module in `master-outline.md`. |
| 3 | Use templates in `roadmap/_templates/` for any new ADR, Handoff, SprintLog. |
| 4 | Commit messages follow conventional commits (`feat:`, `fix:`…). |
| 5 | **Pull-Request Title** must begin with `[roadmap:<epic>/<module>]`. |
| 6 | Fill the PR checklist (docs synced, ADR updated, CI passes). |

## 3  File & Folder Rules
1. **Feature Docs** live under `roadmap/<feature-slug>/` only.  
   _No more edits in `vibecode/` or `docs/`._
2. **Historical docs** reside in `roadmap/_historical/` and are read-only until migrated.
3. **Templates**: copy, never modify originals in `_templates/`.
4. New sprints use ISO folders `roadmap/<feature>/sprints/YYYY-MM-DD/`.

## 4  When Direction Changes
*Propose an ADR or update existing one’s Implementation Log.*  
Use the ADR template; notify the user at the next checkpoint.

## 5  Demonstration-Driven Mindset
– Prefer working prototypes (UI, API response) over long design docs.  
– Attach demo assets in the sprint folder’s `demo/` sub-dir.  
– Record the path in the Handoff Change Summary.

## 6  CI & Automation Hooks
1. **Docs Check** – PR fails if roadmap tag missing or module row not updated.
2. **Template Lint** – ADR / Handoff must include an “Implementation Log” header.
3. **Roadmap Badge** – `README.md` shows % modules completed via badge.

## 7  FAQ
**Q:** Where do I find legacy decisions?  
**A:** `roadmap/_historical/…` search by filename; migrate if still relevant.

**Q:** How do I start a new feature?  
**A:** 1) Create `roadmap/<slug>/outline.md` using `Outline.md` template.  
      2) Add a row to both master docs.  
      3) Open first sprint folder and drop your ADR & Handoff stubs.

---

_This Protocol supersedes the root-level AGENT_COLLABORATION_PROTOCOL.md. Remove or archive older versions to avoid confusion._
