# JavaScript Architecture

This directory contains all the client-side JavaScript for our minimalist frontend framework. Our approach prioritizes vanilla JavaScript, modularity, and a clear separation of concerns, avoiding large external libraries or frameworks.

## File Structure

-   `main.js`: This is our primary script for shared, dynamic content. It handles rendering the "Features" and "Reviews" sections on the landing page by fetching data from our API and `reviews.json`. It should contain logic that is applicable across multiple pages or is central to the site's dynamic nature.

-   `landing-page.js`: This script contains logic that is **specific only to `landing.html`**. It handles the hamburger menu toggle and the login modal functionality for the landing page's unique header and modal structure.

-   `docs.js`: This script contains logic that is **specific only to `docs.html`**. It manages the entire documentation page, including:
    -   Fetching the `docs-manifest.json` to build the navigation.
    -   Loading and rendering markdown content for each section.
    -   Dynamically rendering the "Tools" section from the API.
    -   Handling the collapsible mobile sidebar.
    -   Managing deep-linking to specific tools (e.g., `#tools#make`).

-   `admin-dashboard.js`: (Placeholder for future work) This will contain the logic for the `/admin` page.

## Guiding Principles

1.  **Vanilla First:** All scripts are written in plain, modern JavaScript (ES6+) without any external libraries like jQuery, React, or Vue. The only exception is `marked.js` on the docs page, a small, single-purpose library for Markdown rendering.

2.  **Page-Specific Logic:** To keep scripts small and efficient, create a dedicated JS file for each major page (like `docs.js` or `landing-page.js`) to handle its unique interactive elements.

3.  **Shared Logic in `main.js`:** Use `main.js` for functionality that needs to be shared or that loads dynamic content from APIs, such as the feature tiles.

4.  **Clear Separation of Concerns:** JavaScript is used for interactivity and dynamic content loading. It should not contain any inline HTML or CSS. All content should be rendered into existing, semantic HTML elements. 