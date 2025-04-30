Frontend Interface Specification – StationThis Web
Introduction
This document defines the interface behavior, structure, and user flow for the StationThis Web frontend, which centers around a dynamic, gamified canvas world instead of traditional multipage interfaces.

Entry Flow (Authentication Modal)
Upon landing on the site:

If no valid session or cookies exist, users are shown an Authentication Modal.

Modal Options:

Login (email/password or OAuth, if applicable)

Connect Wallet (Web3 wallet integration)

Continue as Guest (restricted functionality, local-only persistence)

Authenticated users proceed directly to the Canvas World.

Canvas World
Primary Surface: A large animated canvas featuring a classic Gameboy-style water animation.

Core Interaction:

Clicking or tapping the water triggers Workflow Selection Modal.

Selected workflows instantiate Tiles on the canvas.

Canvas is zoomable and pannable, allowing users to navigate a larger working space.

Heads-Up Display (HUD)
Position: Upper Left Corner

Contents:

User EXP Progress

Charge / Energy Level

Username or Guest Tag

Quick Settings (if needed)

HUD remains minimal and non-blocking, designed to fade or minimize when inactive.

Utility Bars
Right Edge Toolbar:

Access to Available Models list

Access to Train New Models system

Access to Settings

Bottom Edge Toolbar:

Access to Collections and Saved Workspaces

Access to Tile Management (Load, Save, Reset layouts)

Toolbars are hidden or semi-transparent by default, revealed on hover or tap.

Workflow Tiles
Each Workflow Tile represents an active or historical generation task.

Tile Properties:

Draggable and Resizable

Linked to a unique run_id

Display live status updates (queued, running, succeeded, failed)

Can be minimized, expanded, or deleted

Tile metadata persists with session/workspace export

Tiles visually reflect workflow type (e.g., txt2img, img2vid).

Canvas Mechanics
Panning: Click and drag empty space to move the view

Zooming: Mouse wheel or pinch-to-zoom

Grid System: Optional light grid background for alignment

Infinite Canvas: Soft boundary edges expand as needed

Canvas navigation should feel fluid, responsive, and spatially intuitive.

Persistence
Users can Save current workspace (all tiles and positions)

Saved workspaces:

Stored locally (for Guests)

Stored remotely (for authenticated users)

Load saved workspaces at login or by manual import

Export/Import workspaces as JSON bundles

Guest Mode Behavior
Guests can access the canvas normally

Guest workspaces are saved to localStorage

No cloud save or cross-device workspace persistence

Some premium workflows may be restricted (TBD)

Error Handling
Tiles visibly change appearance if a workflow fails

Hovering or clicking on an error tile shows details

Retry options appear for failed tasks where possible

Connection loss displays subtle banners, not disruptive popups

Visual Style
Aesthetic: Nostalgic Gameboy pixel art

Water Animation: Looped subtle movement, not distracting

Tiles: Pixel-styled cards

HUD/Toolbars: Lightweight, semi-transparent, modern with pixel hints

Minimal nonessential decoration — focus on user creations

Future Expansion Hooks
(Not required for MVP, but reserved in system design)

Multi-user collaborative canvas mode

Live activity feed from other users ("splashes" on water)

Global navigation to other themed canvases (sky, city, etc.)