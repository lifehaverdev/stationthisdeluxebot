# CSS Architecture

This directory contains all the custom CSS for our minimalist frontend framework. The architecture is designed to be modular, maintainable, and easy to understand, following a component-based approach inspired by modern frameworks but with zero external dependencies.

## File Structure

-   `main.css`: The central stylesheet and the **only** CSS file linked in our HTML. It does not contain any styles itself; it only imports all other necessary stylesheets.
-   `variables.css`: Defines our design system's core tokens as CSS Custom Properties. This includes all colors, fonts, spacing units, and other reusable values.
-   `base.css`: Contains global styles that apply to the entire site. This includes resets, typography for basic HTML elements (`body`, `h1`, `a`, etc.), and the background animation.
-   `components/`: This directory holds the stylesheets for our reusable UI components.
    -   `index.css`: An aggregator file that imports all the individual component stylesheets.
    -   `panel.css`: Styles for the main "frosted glass" content panels.
    -   `header.css`: Styles for the site-wide header and responsive navigation.
    -   `buttons.css`: Styles for all button variations.
    -   `modal.css`: Styles for the login modal.
    -   `features.css`: Styles for the feature tiles on the landing page.
    -   `reviews.css`: Styles for the user review cards.
    -   `...and so on.`
-   `docs.css`: Contains styles that are specific *only* to the documentation page layout and its unique components.

## Guiding Principles

1.  **Component-Based:** Every distinct, reusable piece of the UI (a button, a modal, a card) should have its own CSS file in the `components` directory.
2.  **Centralized Design System:** Never use hard-coded values for colors, fonts, or spacing. Always use the CSS variables defined in `variables.css`. This ensures visual consistency and makes rebranding or theme updates trivial.
3.  **Single Entry Point:** `main.css` is the single source of truth for all styles. To add a new component style, create its file and import it into `components/index.css`.
4.  **Mobile-First:** Write base styles for mobile and then use `@media (min-width: ...)` queries to add or override styles for larger screens. This results in cleaner, more efficient CSS. 