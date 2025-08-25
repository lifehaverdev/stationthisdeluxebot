# ADR-2025-08-13: Private Checkpoint Indicator in Mods Menu

## Context

The Mods Menu model browser (web sandbox) must clearly distinguish private checkpoints that reside under `checkpoints/users/<uid>/`.  
Earlier iterations either hid these models or displayed them without any visual cue, leading to confusion for power-users running multiple accounts on the same worker.

## Decision

1. Treat **any** model whose `path` or `save_path` contains `checkpoints/users/` as *private*.
2. Render a lock emoji (🔒) immediately to the **left of the favourites heart button** within each private row.  
   • Implemented via an inline `<span class="priv-icon">` in the HTML template.  
   • CSS `.priv-icon { margin-left:4px; margin-right:2px; }` ensures tight spacing.
3. Remove the former pseudo-element rule (`.mods-item.private::before`) to avoid duplicate icons.
4. Fallback behaviour:
   • If `window.currentUserId` is undefined (SSR omission) we **still** mark the row as private.  
   • Ownership filtering remains: other users’ private checkpoints are hidden unless matching the current user.

## Consequences

• Users can now instantly recognise their private checkpoints.  
• No unnecessary re-renders or duplicate icons.  
• Logic is resilient to missing `currentUserId` globals.

## Outstanding Work (tracked for upcoming sprints)

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | LocalStorage caching of `/models/stats` & category lists (10 min TTL) | Web | TODO |
| 2 | Canvas integration – insert selected model into graph | Web | TODO |
| 3 | Search & pagination for large model sets | Web | TODO |
| 4 | Preview metadata (SHA256, sample image) in detail view | Backend+Web | TODO |
| 5 | Permissions check for private **LoRAs** (not just checkpoints) | Backend | TODO |
| 6 | Share ModelMenuCore with Telegram `ModsMenuManager` | Cross-platform | TODO |
| 7 | LoRA list rework – show trigger words inline & tile-based preview images (lazy-load on scroll) | Web | TODO |

## Implementation Log

**2025-08-13**  
• Added inline lock span in `ModsMenuModal.js` and refined spacing in `modsMenuModal.css`.  
• Fixed private-path detection to ignore leading slash requirement.  
• Removed duplicate `fetchFavorites` call and obsolete CSS pseudo-element.  
• Updated legacy ADR (vibecode) for historical completeness.

---
_This ADR follows **AGENT COLLABORATION PROTOCOL – v3** and supersedes scattered notes in `vibecode/decisions/adr/` for this feature._
