# Next Agent Prompt: Continue Discord-Telegram Parity Implementation

## Your Mission

Continue the Discord-Telegram platform parity implementation. The Discord platform is ~85% complete with core features working well. Your primary focus should be fixing the reply-to-message image extraction feature and completing testing.

## Current Status

✅ **What's Working:**
- All core commands (`/status`, `/settings`, `/account`, `/mods`, `/tools`, `/wallet`, `/link`)
- All component managers (settings, account, wallet, link, mods, tools)
- All delivery menu features (info, rate, rerun, tweak, hide)
- Dynamic command system (generates slash commands from ToolRegistry)
- Notification delivery system
- Message formatting and markdown escaping

⚠️ **What Needs Work:**
- **Reply-to-message image extraction** (critical - see investigation doc)
- Complete testing of all features
- Edge case handling
- Error message improvements

## Your Primary Task: Fix Reply-to-Message Image Extraction

### The Problem
Users should be able to:
1. Reply to a bot message containing an image
2. Use a slash command like `/effect`
3. Bot extracts the image from the replied-to message and uses it

**Current Issue:** The bot finds reply messages but cannot extract images. Messages return "Unknown Message" or are found but show 0 attachments/embeds.

### Investigation Document
Read `docs/DISCORD_REPLY_TO_MESSAGE_INVESTIGATION.md` for:
- Detailed problem analysis
- Current implementation details
- Logs analysis
- What we've tried
- Questions to investigate

### Key Files
- `src/platforms/discord/utils/discordUtils.js` - Main implementation (needs fixing)
- `src/platforms/discord/dynamicCommands.js` - Calls the extraction function
- `src/platforms/telegram/utils/telegramUtils.js` - Reference implementation

### Success Criteria
- User replies to bot message with image
- User uses `/effect` command
- Bot successfully extracts image URL from replied-to message
- Bot uses image as input for tool
- Works reliably in all scenarios

## Secondary Tasks

1. **Complete Testing**
   - Test all component managers end-to-end
   - Test error scenarios
   - Test edge cases (deleted messages, permissions, etc.)

2. **Improve Error Messages**
   - Make error messages more user-friendly
   - Surface API errors to users when appropriate

3. **Optimize**
   - Improve message fetching efficiency
   - Optimize command registration timing
   - Add retry logic for API failures

## How to Get Started

1. **Read the Handoff Document**
   - `docs/DISCORD_TELEGRAM_PARITY_HANDOFF.md` - Complete status report

2. **Read the Investigation Document**
   - `docs/DISCORD_REPLY_TO_MESSAGE_INVESTIGATION.md` - Detailed problem analysis

3. **Test Current Implementation**
   - Run the bot and test the reply-to-message feature
   - Check the logs to see what's happening
   - Understand the current behavior

4. **Investigate the Issue**
   - Why do messages return "Unknown Message"?
   - Why do messages show 0 attachments/embeds?
   - Are we fetching messages correctly?
   - Are there Discord.js options we're missing?

5. **Fix and Test**
   - Implement the fix
   - Test thoroughly
   - Verify it works in all scenarios

## Key Patterns to Follow

1. **Component Manager Pattern**
   - Each feature has its own manager in `src/platforms/discord/components/`
   - Managers handle all interactions for their feature
   - Follow existing patterns

2. **Dispatcher Pattern**
   - All interactions route through dispatchers
   - Handlers register with dispatchers by prefix/pattern
   - Handler signature: `(client, interaction, masterAccountId, dependencies)`

3. **Interaction Deferral**
   - Check `interaction.deferred || interaction.replied` before replying
   - Use `followUp()` if already deferred, `reply()` if not
   - All button/select menu interactions are deferred in `bot.js`

4. **Dependency Injection**
   - All handlers receive full dependencies object
   - Access services via `dependencies.serviceName`
   - No global state

## Common Pitfalls to Avoid

1. **Don't forget to defer interactions** - Discord requires acknowledgment within 3 seconds
2. **Don't mix reply() and followUp()** - Check interaction state first
3. **Don't exceed component limits** - Max 5 action rows per message
4. **Don't use shared CommandRegistry** - Each platform has its own
5. **Don't refactor Telegram code** - Build Discord independently

## Reference Implementation

- `src/platforms/telegram/` - Telegram implementation (reference for parity)
- `src/platforms/telegram/utils/telegramUtils.js` - How Telegram extracts file URLs
- `src/platforms/telegram/dynamicCommands.js` - How Telegram handles dynamic commands

## Questions to Answer

1. Why do Discord messages return "Unknown Message" when fetched?
2. How can we reliably extract images from bot messages?
3. Should we use message context menu commands as an alternative?
4. Can we store message IDs when sending notifications for faster lookup?
5. Are there Discord.js options we're missing?

## Success Looks Like

- ✅ Reply-to-message image extraction works reliably
- ✅ All features tested and working
- ✅ Error messages are user-friendly
- ✅ Code follows existing patterns
- ✅ Full parity with Telegram features

## Getting Help

- Check `docs/DISCORD_TELEGRAM_PARITY_HANDOFF.md` for detailed status
- Check `docs/DISCORD_REPLY_TO_MESSAGE_INVESTIGATION.md` for problem analysis
- Review existing component managers for patterns
- Check Discord.js documentation for API details

---

**Good luck! The foundation is solid - you just need to fix the reply-to-message feature and polish the edges. 🚀**

