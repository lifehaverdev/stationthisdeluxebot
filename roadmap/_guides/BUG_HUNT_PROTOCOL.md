# BUG HUNT PROTOCOL – v1 (Post-Deploy)

> **Purpose**: Provide an **instant-switch** reference for LLM agents and human contributors when the primary goal is **bug hunting & hot-fixes** on a live repo.

---

## 1  Quick Invocation
```
🪲  BUGHUNT MODE ON
```
Mention the phrase above (or reference this file) to signal that **all replies, searches, and edits** should follow the rules in this protocol until “BUGHUNT MODE OFF” is declared.

---

## 2  First 5 Minutes Checklist
1. **Reproduce** – confirm the bug locally or in the reported environment (prod / staging).
2. **Capture Evidence** – logs, stack traces, network payloads, screenshots, env info.
3. **Tag the Bug** – create / link an issue with label `bughunt` + severity (S1–S4).
4. **Locate Impact Area** – find module / feature folder in `roadmap/`.
5. **Skim History** – search `roadmap/_historical/` for prior related decisions.

---

## 3  Live Session Workflow
| Step | Action |
|------|--------|
| 1 | **Hypothesise** root cause; list likely files / functions. |
| 2 | **Gather** code with semantic search + grep (parallel calls). |
| 3 | **Confirm** with a minimal failing test or reproduction script. |
| 4 | **Patch** – implement fix **in one bulk edit** (user preference). |
| 5 | **Verify** – rerun failing case, run test suite, smoke-test critical flows. |
| 6 | **Log** – append findings to the module’s ADR *Implementation Log*. |
| 7 | **Commit & PR** – `fix(bughunt:<module>): <concise summary>` |
| 8 | **Deploy** – follow hot-fix deploy checklist (link). |

---

## 4  Tool & Command Conventions
- Use **parallel** tool calls for searches (per Maximisation Rules).
- Prefer **exact grep** for symbols, **semantic search** for behaviour.
- **Never** run production scripts automatically; user triggers all runtime commands.
- Prefix emergency scripts with `scripts/debug/` and document in PR.

---

## 5  Logging & Docs
1. Each bug session gets a log file:  
   `roadmap/_logs/bughunt/YYYY-MM-DD/<bug-slug>.md`
2. Include: reproduction steps, root cause, patch diff link, verification steps, follow-up tasks.
3. After merge, update `master-outline.md` status column if module stability changes.

---

## 6  Severity & SLA
| Severity | Definition | Response Time |
|----------|------------|---------------|
| **S1** | Prod down / data loss | Patch ≤ 1h |
| **S2** | Major feature broken | Patch ≤ 4h |
| **S3** | Minor issue / workaround exists | Patch ≤ 24h |
| **S4** | Cosmetic / edge case | Batch in next sprint |

---

## 7  Post-Mortem
Within 24h of an S1-S2 fix, publish a *Post-Mortem* under  
`roadmap/_historical/docs-postmortems/YYYY-MM-DD-<slug>.md`  
using the Incident PM template.

---

## 8  FAQ
**Q:** How do we exit bughunt mode?  
**A:** Type `BUGHUNT MODE OFF` or reference another protocol (e.g. `AGENT_COLLABORATION_PROTOCOL_v3`).

**Q:** Where do hot-fix branches live?  
**A:** `hotfix/<module>/<issue-id>` – auto-deleted after merge & tag.
