# iStats.js Plan

## Current Purpose
`iStats.js` provides statistical insights and analytics about the bot's usage. It collects and displays metrics such as user growth, command utilization, interaction patterns, and generation statistics. The module serves both administrators (with detailed stats) and regular users (with limited stats).

## Exported Functions/Classes
- **Main Function**:
  - `iStats(message)` - Main handler for the `/stats` command

- **Data Collection Functions**:
  - `getStats()` - Collects and aggregates all statistical data

- **Utility Functions**:
  - `escapeMarkdown(text)` - Escapes Markdown characters for proper display

## Dependencies and Integrations
- Database models:
  - `UserCoreDB` - For user data
  - `UserStats` - For usage statistics
  - `AnalyticsEvents` - For event tracking
- Bot components:
  - `commandRegistry` from bot module
- Utility functions:
  - `sendMessage` for message delivery
- Constants:
  - `DEV_DMS` to identify developer chat
  - `EVENT_TYPES` for analytics event categorization

## Identified Issues
- Tightly coupled with Telegram message format
- Direct database queries embedded in the handler
- Complex data aggregation logic mixed with presentation
- Limited error handling
- Hard-coded time windows (24h, 7 days, 14 days)
- No separation between data collection and formatting
- No caching mechanism for frequently requested stats
- Markdown escaping done manually rather than using a utility

## Migration Plan
1. Create `src/core/analytics/`:
   - `collector.js` - Data collection and aggregation
   - `metrics.js` - Metric definitions and calculations
   - `formatter.js` - Data formatting for different outputs

2. Create `src/core/stats/`:
   - `user.js` - User growth and retention stats
   - `interaction.js` - Command and feature usage stats
   - `generation.js` - Image generation stats
   - `service.js` - Orchestration of different stat types

3. Create `src/integrations/telegram/stats.js`:
   - Telegram-specific stats command handler
   - Stats formatting for Telegram messages
   - Permission-based stats display

4. Implement `src/api/stats.js`:
   - Internal API for statistics
   - Endpoints for different stat categories
   - Authentication for admin-only stats

5. Suggested improvements:
   - Implement caching for frequently accessed stats
   - Create configurable time windows for different metrics
   - Add visualization options for complex metrics
   - Implement proper error handling with fallbacks
   - Create a permission system for accessing different levels of stats
   - Add scheduled stats generation for reports
   - Implement stat notifications for significant changes
   - Create a dashboard interface for viewing stats 