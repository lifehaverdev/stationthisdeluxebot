# Workspace System - Quick Test Checklist

**Quick reference for rapid testing**

---

## 🚀 5-Minute Smoke Test

- [ ] **Basic Save/Load**
  - Add 1 tool → Click 💾 Save → Copy URL → Open in new tab → Tool appears?

- [ ] **Tab Switching**
  - Create workspace → Click ➕ → Switch back → Original workspace intact?

- [ ] **URL Loading**
  - Save workspace → Copy URL → Open in incognito → Loads correctly?

---

## 🔥 Critical Edge Cases (15 minutes)

### Race Conditions
- [ ] Click 💾 Save 5 times rapidly → Only one save happens?
- [ ] Click ➕ Add Tab 5 times rapidly → No crashes?
- [ ] Switch tabs rapidly (10 clicks) → No data loss?

### Network Failures
- [ ] Disable network → Try to save → Shows error?
- [ ] Disable network → Try to load → Shows error?
- [ ] Save → Disconnect mid-request → Retries?

### Empty/Invalid States
- [ ] Save empty workspace → Shows "Nothing to save"?
- [ ] Load invalid workspace ID → Shows error?
- [ ] Load workspace with deleted tool → Shows warning?

### Tab System
- [ ] Create workspace → Add tab → Close original → New tab active?
- [ ] Create workspace → Save → Close tab → Reopen → Still there?
- [ ] Create workspace → Switch tabs → Close browser → Reopen → Tabs restored?

---

## 💣 Stress Tests (10 minutes)

- [ ] **Large Workspace**
  - Add 20+ tools → Save → Loads in < 5 seconds?
  - Add large images → Save → Size limit handled?

- [ ] **Many Tabs**
  - Create 5 tabs → Each with workspace → Switch between → All work?

- [ ] **Concurrent Operations**
  - Save workspace → Immediately switch tabs → Both complete?

---

## 🐛 Known Issues to Verify Fixed

- [ ] **Tab Switching Bug** (FIXED)
  - Add tab → Original workspace preserved? ✅

- [ ] **Race Conditions** (FIXED)
  - Rapid operations → No conflicts? ✅

- [ ] **Error Messages** (FIXED)
  - All errors show helpful messages? ✅

---

## 🎯 Quick Test Scenarios

### Scenario 1: New User Flow
1. Open sandbox
2. Add 3 tools
3. Connect 2 tools
4. Save workspace
5. Copy URL
6. Open in new tab
7. ✅ All tools and connections appear?

### Scenario 2: Power User Flow
1. Create workspace with 10 tools
2. Add 3 tabs
3. Switch between tabs
4. Make changes in each
5. Save all
6. Close browser
7. Reopen
8. ✅ All tabs and changes preserved?

### Scenario 3: Error Recovery
1. Create workspace
2. Disable network
3. Try to save → Error shown?
4. Re-enable network
5. Save again → Success?
6. ✅ User can recover?

### Scenario 4: Resource Deletion
1. Create workspace with tool
2. Save workspace
3. Delete tool from registry (or make unavailable)
4. Load workspace
5. ✅ Shows warning/placeholder?

---

## 🔍 What to Look For

### ✅ Good Signs
- Smooth tab switching
- Clear error messages
- Loading indicators
- No console errors
- Fast save/load

### ❌ Red Flags
- Data loss on tab switch
- Silent failures
- Generic error messages
- UI freezing
- Console errors
- Race conditions

---

## 📝 Quick Bug Report Template

**Issue:** [Brief description]

**Steps:**
1. 
2. 
3. 

**Expected:** 
**Actual:** 

**Console Errors:**
```
[paste errors here]
```

**Workspace Slug:** [if applicable]

---

## 🎲 Random Testing Ideas

- Try saving while tool is executing
- Try loading while another load is in progress
- Try switching tabs while save is in progress
- Try closing browser mid-save
- Try loading workspace with 100+ tools
- Try creating workspace with circular connections
- Try saving workspace with XSS in tool names
- Try loading workspace from different browser
- Try loading workspace without internet (cached)
- Try rapid tab create/delete/switch

---

**Pro Tip:** Keep browser DevTools open (Console + Network tabs) to catch errors and see API calls!

