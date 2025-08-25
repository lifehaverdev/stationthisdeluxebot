> Imported from vibecode/bulk/decisions/adr/ADR-014-Minimalist-Frontend-Framework.md on 2025-08-21

# ADR-014: Minimalist Frontend Framework

## Creative Vision

The guiding aesthetic is an "ambient cognition field that breathes like a dream and thinks like an algorithm." This translates to a two-part user experience:

1.  **The Landing Page (The Cloudbank):** The visual theme is a high-resolution conceptual dreamscape. We look down from the sky into a soft, pastel cloudbank with a calm digital ocean horizon. The mood is tranquil, synthetic, and evokes latent intelligence. The palette consists of soft pinks, warm peach, oceanic teal, and glacial white.
2.  **The Application (The Ocean):** After login, the user descends through the clouds to a liquid sandbox workspace styled like a retro, tiled ocean, creating a tactile and interactive environment.

All of this will be rendered with an elegant, monospaced typography that feels like a classic command-line interface, but with the polished, "steel" aesthetic of early Apple design. The core components will feel like "abstract translucent panels" floating in this dreamscape.

## Context
We need to build a visually stunning, highly custom website that embodies a unique "ambient cognition field" aesthetic. The project requires a frontend that is lightweight, performant, and maintainable. There is a strong, explicit directive from the project lead to avoid "bloatmaxxing"—the inclusion of heavy external libraries and dependencies that add complexity and slow down performance.

## Decision
We will build the frontend using only vanilla HTML, CSS, and JavaScript.

To achieve our complex design goals in an organized manner, we will create a custom, utility-first CSS framework inspired by Tailwind CSS. We explicitly will **NOT** use external CSS frameworks (e.g., Bootstrap, Tailwind), JS frameworks (e.g., React, Vue, Angular), or large third-party utility libraries.

Our custom framework will include:
1.  **A Centralized Design System:** Core design tokens (colors, fonts, spacing, etc.) will be defined as CSS custom properties in a single, dedicated file.
2.  **Utility-First Classes:** A set of CSS classes will be created to apply these design tokens directly within the HTML (e.g., `.bg-peach`, `.text-mono`, `.p-4`).
3.  **Organized File Structure:** CSS will be broken down into logical files (e.g., `variables.css`, `base.css`, `utilities.css`, `components.css`) for maintainability.

## Consequences

### Pros:
-   **No Dependency Bloat:** The final product will be extremely lightweight with zero external dependencies.
-   **Maximum Performance:** Page load times will be exceptionally fast.
-   **Full Creative Control:** We have total control over every line of code, allowing us to perfectly implement the desired aesthetic without fighting framework opinions.
-   **Simplicity & Longevity:** The technology stack is simple, stable, and easy for any web developer to understand and maintain for years to come.

### Cons:
-   **Upfront Development Time:** We are responsible for building the framework itself, including the grid system, responsive utilities, and component styles that would otherwise come pre-packaged.
-   **Manual Implementation:** We will need to manually implement features like complex interactivity or state management that JS frameworks often simplify.

## Alternatives Considered
-   **Tailwind CSS:** Rejected due to the core decision to avoid external dependencies and the associated build tool complexity.
-   **React, Vue, or other JS Frameworks:** Explicitly rejected by the project lead. These frameworks introduce a level of abstraction and dependency that is counter to the project's minimalist philosophy. 