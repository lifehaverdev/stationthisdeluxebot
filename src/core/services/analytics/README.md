# README: Analytics Service (`src/core/services/analytics`)

## Overview

This directory will contain the components for an administrative analytics dashboard. The primary goal is to provide insights into the bot's performance, user behavior, and economic activity.

We are adopting an "Analytics First" iterative approach: an initial MVP dashboard will be built using data from the existing `stationthisbot` database. The learnings and requirements gathered from this process will directly inform the design and capabilities of the new `noema` database system and its associated database access layer (`src/core/services/db`).

## Goals

1.  **Provide Actionable Insights:** Offer administrators a clear view of key performance indicators (KPIs), user engagement, and bot economics.
2.  **Inform `noema` Design:** Use the practical experience of building analytics on the current `stationthisbot` data to identify limitations and refine the requirements for the `noema` database schema and its query capabilities.
3.  **Iterative Development:** Start with a Minimum Viable Product (MVP) dashboard and enhance it over time.
4.  **Data-Driven Refinement:** Ensure that the future `noema` database and its access layer are well-equipped to support robust and efficient analytics.

## Phased Approach

### Phase A: MVP Analytics Dashboard on `stationthisbot` Data

*   **Objective:** Quickly build a functional dashboard providing initial insights from the current live database.
*   **Data Source:** `stationthisbot` MongoDB database.
*   **Key Activities:**
    *   Define and prioritize a small set of initial metrics (see below).
    *   Develop backend API endpoints (Node.js/Express.js) to query `stationthisbot` data using existing DB access methods or direct queries.
    *   Build a simple frontend (e.g., server-rendered HTML with EJS, or a lightweight SPA) to display these metrics and visualizations.
*   **Focus:** Rapid development, learning, and identification of current data model limitations.

### Phase B: Enhanced Analytics Dashboard on `noema` Data

*   **Objective:** Transition and expand the analytics dashboard to use the new `noema` database as its primary source.
*   **Data Source:** `noema` MongoDB database.
*   **Key Activities:**
    *   Adapt backend API endpoints to use the new `src/core/services/db` layer for `noema`.
    *   Leverage the improved schema (e.g., `transactions` collection, `workflowExecutions` collection, `masterAccountId`) for more powerful and accurate analytics.
    *   Implement new metrics and visualizations that were difficult or impossible with the old schema.

## Initial Target Metrics (Examples for MVP on `stationthisbot`)

*   **User Activity:**
    *   Daily Active Users (DAU)
    *   Weekly Active Users (WAU)
    *   Monthly Active Users (MAU)
    *   New user registrations over time.
*   **Engagement & Bot Usage:**
    *   Most frequently used commands/workflows.
    *   Distribution of user Experience Points (EXP).
    *   Number of API keys generated.
*   **Economic Activity (Proxy via `qoints` or other relevant fields):**
    *   Volume of `qoints` spent/generated daily/weekly.
    *   Potentially, an estimation of compute resource consumption.
*   **Technical:**
    *   Counts of different wallet types connected.

## Proposed Technology Stack (for MVP)

*   **Backend:** Node.js / Express.js (leveraging the existing `app.js` structure).
*   **Database Interaction (Phase A):** Existing `db/models/` classes or direct MongoDB queries on `stationthisbot`.
*   **Frontend (Phase A):** Server-Side Rendered HTML with EJS (Embedded JavaScript templates) for simplicity and speed, or a lightweight client-side framework.
*   **Charting Library:** Chart.js, ApexCharts, or similar.

## Development Approach

The analytics service will be developed in an agile manner. The initial focus for Phase A is to set up the basic routing and serve a placeholder admin page, then iteratively add individual metrics and views. 