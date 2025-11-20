# Workspace System

StationThis Deluxe's sandbox workspace system lets you save, load, and share your entire canvas state—including all tool windows, connections, parameters, and outputs—across devices and sessions.

## Overview

The workspace system provides:

- **Cloud Persistence** – Save workspaces to the cloud and access them from any device
- **Shareable Links** – Share your workspace with others via a simple URL
- **Multiple Tabs** – Work on multiple workspaces simultaneously
- **Auto-save** – Workspaces automatically save when switching tabs
- **Local Backup** – Workspaces are also cached locally for offline access

## Quick Start

### Saving a Workspace

1. **Click the Save button** (💾) in the workspace tabs bar
2. Your workspace is saved to the cloud
3. A shareable link is copied to your clipboard
4. The URL updates to include your workspace ID: `?workspace=abc123`

### Loading a Workspace

**Option 1: From URL**
- Open a workspace link (e.g., `https://stationthis.com/sandbox?workspace=abc123`)
- The workspace loads automatically

**Option 2: Manual Load**
- Click the Load button (📂) in the workspace tabs bar
- Paste or enter a workspace ID or URL
- The workspace loads and replaces your current canvas

### Using Multiple Tabs

1. **Add a new tab** – Click the "+" button in the tabs bar
2. **Switch between tabs** – Click any tab to switch workspaces
3. **Auto-save** – Your current workspace automatically saves when switching tabs
4. **Close tabs** – Click the "×" on any tab to close it (you can't close the last tab)

## Features

### What Gets Saved

A workspace snapshot includes:

- **Tool Windows** – All tool windows with their positions, parameters, and outputs
- **Connections** – All connections between tool windows
- **Spell Windows** – Spell windows with their parameter mappings
- **Output Versions** – Up to 5 recent output versions per window
- **Window Positions** – Exact positions of all windows on the canvas

### What Doesn't Get Saved

- **Large Data URLs** – Images stored as data URLs are stripped to save space (remote URLs are preserved)
- **Old Output Versions** – Only the 5 most recent versions are kept
- **Temporary State** – Selection state, undo/redo history, etc.

### Size Limits

- **Maximum Workspace Size:** 900 KB
- **Why:** Ensures fast loading and prevents server overload
- **What to do if exceeded:** Remove some tool windows or outputs, or clean up old output versions

If your workspace is too large, you'll see a clear error message with guidance on how to reduce the size.

## Sharing Workspaces

### Public Workspaces

By default, workspaces are **public** and can be accessed by anyone with the link:

1. Save your workspace
2. Copy the URL (automatically copied to clipboard)
3. Share the URL with anyone
4. They can open it in their browser and see your workspace

### Private Workspaces

Private workspaces are only accessible to you:

- Only you can view and edit private workspaces
- Others will see an error if they try to access a private workspace link
- Private workspaces are marked with a lock icon 🔒

*Note: Private workspace support is coming soon.*

## Error Handling

The workspace system provides clear, actionable error messages:

### Common Errors

**"Nothing to save yet! Add some tools first."**
- Your workspace is empty
- Add some tool windows before saving

**"Workspace is too large (XKB). Maximum size is 900KB."**
- Your workspace exceeds the size limit
- Remove some tool windows or outputs
- Clean up old output versions

**"Workspace not found. It may have been deleted."**
- The workspace ID doesn't exist
- Check the URL or workspace ID
- The workspace may have been deleted

**"You do not have permission to update this workspace."**
- You're trying to update someone else's workspace
- Save as a new workspace instead

**"Network error. Please check your connection."**
- Your internet connection is down
- Check your network and try again
- The system will automatically retry

**"Failed to save workspace."**
- A server error occurred
- Try again in a few moments
- If it persists, check your internet connection

### Retry Logic

The system automatically retries failed operations:

- **3 retry attempts** with exponential backoff
- **Automatic retry** for network failures
- **User notification** if all retries fail

## Best Practices

### Organizing Your Work

1. **Use Multiple Tabs** – Keep different projects in separate tabs
2. **Name Your Workspaces** – Give workspaces descriptive names (coming soon)
3. **Clean Up Regularly** – Remove unused tool windows to keep workspaces lean
4. **Save Frequently** – Workspaces auto-save on tab switch, but you can manually save anytime

### Performance Tips

- **Limit Output Versions** – Each window keeps up to 5 output versions
- **Remove Old Outputs** – Delete tool windows you no longer need
- **Use Remote URLs** – Prefer remote image URLs over data URLs when possible
- **Keep Workspaces Focused** – Split large projects across multiple workspaces

### Sharing Tips

- **Test Your Links** – Open workspace links in an incognito window to verify they work
- **Document Your Workspace** – Add notes or descriptions (coming soon)
- **Share Publicly** – Public workspaces can be accessed by anyone with the link
- **Keep Sensitive Data Private** – Don't include sensitive information in public workspaces

## Troubleshooting

### Workspace Won't Load

1. **Check the URL** – Make sure the workspace ID is correct
2. **Check Your Connection** – Ensure you have internet access
3. **Try Refreshing** – Refresh the page and try again
4. **Check Console** – Open browser DevTools to see error messages

### Workspace Missing Tools/Spells

If a workspace references tools or spells that no longer exist:

- **Missing Tools** – Tool windows will show a warning
- **Missing Spells** – Spell windows will show a placeholder
- **Private Spells** – You'll see a placeholder if you don't have access

The workspace will still load, but some windows may not function correctly.

### Tab State Lost

If your tabs disappear after refreshing:

- **Check localStorage** – Make sure your browser allows localStorage
- **Don't Clear Data** – Clearing browser data will remove tab state
- **Recreate Tabs** – You can manually recreate tabs and load workspaces

### Can't Save Workspace

1. **Check Size** – Your workspace may be too large
2. **Check Connection** – Ensure you have internet access
3. **Check Permissions** – Make sure you're logged in (if required)
4. **Try Again** – The system will retry automatically

## FAQ

**Q: Can I save multiple versions of the same workspace?**  
A: Yes! Each save creates a new workspace with a unique ID. You can save as many versions as you want.

**Q: What happens if I delete a tool that's in a saved workspace?**  
A: The workspace will still load, but the tool window will show a warning that the tool is missing.

**Q: Can I edit someone else's workspace?**  
A: You can view public workspaces, but you can only edit workspaces you own. Editing someone else's workspace will create a new workspace.

**Q: How long are workspaces stored?**  
A: Workspaces are stored indefinitely. There's no automatic deletion.

**Q: Can I recover a deleted workspace?**  
A: Not currently, but workspace recovery is planned for the future.

**Q: Do workspaces work offline?**  
A: Workspaces are cached locally, so you can view them offline, but you need internet to save or load from the cloud.

**Q: Can I share a workspace with someone who doesn't have an account?**  
A: Yes! Public workspaces can be accessed by anyone with the link, no account required.

---

_Last updated: 2025-01-27_

