# Workspace System Testing Guide

**Date:** 2025-01-27  
**Purpose:** Comprehensive testing scenarios to find edge cases and verify reliability

---

## Critical Path Testing

### 1. Basic Save/Load Flow
- [ ] Create workspace with 1 tool window → Save → Reload page → Verify tool appears
- [ ] Create workspace with 5 tool windows → Save → Load in new tab → Verify all tools appear
- [ ] Create workspace with connections → Save → Load → Verify connections restored
- [ ] Create workspace with spell window → Save → Load → Verify spell appears
- [ ] Create workspace with collection window → Save → Load → Verify collection appears

### 2. Tab System
- [ ] Create workspace → Add new tab → Switch back → Verify original workspace intact
- [ ] Create workspace → Add 3 tabs → Switch between them → Verify each loads correctly
- [ ] Create workspace → Save → Close tab → Verify workspace persists
- [ ] Create workspace → Add tab → Close original tab → Verify new tab becomes active
- [ ] Create workspace → Rapidly click "+" 5 times → Verify no race conditions
- [ ] Create workspace → Rapidly switch tabs → Verify no data loss

### 3. URL Parameter Loading
- [ ] Save workspace → Copy URL → Open in incognito → Verify workspace loads
- [ ] Save workspace → Copy URL → Open in different browser → Verify workspace loads
- [ ] Load workspace via URL → Add content → Save → Verify updates correctly
- [ ] Load workspace via URL → Close tab → Reopen URL → Verify still loads

---

## Edge Cases

### 4. Empty Workspace
- [ ] Save completely empty workspace → Verify error message
- [ ] Create workspace → Delete all tools → Try to save → Verify behavior
- [ ] Load workspace → Clear all → Switch tabs → Verify blank state persists

### 5. Large Workspace
- [ ] Create workspace with 50+ tool windows → Save → Verify success
- [ ] Create workspace with large outputs (images) → Save → Verify size limit handling
- [ ] Create workspace → Add outputs until near 900KB limit → Save → Verify success
- [ ] Create workspace → Exceed 900KB limit → Save → Verify error message
- [ ] Create workspace with many output versions → Save → Verify only 5 kept per window

### 6. Missing/Deleted Resources
- [ ] Create workspace with tool → Delete tool from registry → Load workspace → Verify handling
- [ ] Create workspace with spell → Make spell private → Load as different user → Verify placeholder
- [ ] Create workspace with spell → Delete spell → Load workspace → Verify error handling
- [ ] Create workspace with collection → Delete collection → Load workspace → Verify handling

### 7. Network Failures
- [ ] Disable network → Try to save → Verify error message
- [ ] Disable network → Try to load → Verify error message
- [ ] Save workspace → Disconnect mid-request → Verify retry logic
- [ ] Load workspace → Disconnect mid-request → Verify retry logic
- [ ] Save workspace → Server returns 500 → Verify error handling
- [ ] Load workspace → Server returns 404 → Verify error message

### 8. Concurrent Operations
- [ ] Click save button 5 times rapidly → Verify only one save happens
- [ ] Click load button while save in progress → Verify queue works
- [ ] Switch tabs rapidly (10 clicks) → Verify no data loss
- [ ] Save workspace → Immediately switch tabs → Verify both complete
- [ ] Load workspace → Immediately save → Verify no conflicts

### 9. Browser Storage Limits
- [ ] Fill localStorage to near limit → Save workspace → Verify handling
- [ ] Save workspace → Clear localStorage → Load → Verify error handling
- [ ] Save workspace → Fill localStorage → Try to save again → Verify fallback

### 10. State Corruption Scenarios
- [ ] Manually corrupt localStorage → Load page → Verify graceful handling
- [ ] Save workspace → Manually edit localStorage → Load → Verify validation catches it
- [ ] Save workspace → Delete connections key → Load → Verify handles missing data
- [ ] Save workspace → Delete toolWindows key → Load → Verify handles missing data

---

## Data Integrity Testing

### 11. Snapshot Validation
- [ ] Create workspace → Manually edit saved snapshot → Try to load → Verify validation error
- [ ] Create workspace → Remove required field from snapshot → Try to load → Verify error
- [ ] Create workspace → Add invalid field to snapshot → Try to load → Verify validation
- [ ] Create workspace → Corrupt JSON in localStorage → Load → Verify error handling

### 12. Tool Matching
- [ ] Create workspace with tool → Rename tool displayName → Load → Verify still matches
- [ ] Create workspace with tool → Change tool toolId → Load → Verify fallback to displayName
- [ ] Create workspace with tool → Delete tool → Load → Verify missing tool warning
- [ ] Create workspace with duplicate displayNames → Load → Verify correct matching

### 13. Spell Window Handling
- [ ] Create workspace with public spell → Load → Verify loads correctly
- [ ] Create workspace with private spell → Load as owner → Verify loads correctly
- [ ] Create workspace with private spell → Load as different user → Verify placeholder
- [ ] Create workspace with deleted spell → Load → Verify error handling
- [ ] Create workspace with spell → Spell becomes private → Load → Verify placeholder

---

## UI/UX Testing

### 14. User Feedback
- [ ] Save workspace → Verify success notification appears
- [ ] Save workspace → Verify loading indicator shows
- [ ] Save workspace → Fail → Verify error notification appears
- [ ] Load workspace → Verify loading indicator shows
- [ ] Load workspace → Fail → Verify error notification appears
- [ ] Switch tabs → Verify autosave notification (if not silent)

### 15. Error Messages
- [ ] Save empty workspace → Verify "Nothing to save" message
- [ ] Save oversized workspace → Verify size limit error message
- [ ] Load invalid workspace ID → Verify "not found" message
- [ ] Load workspace without permission → Verify "forbidden" message
- [ ] Network error → Verify network error message
- [ ] Server error → Verify server error message

### 16. Tab State Management
- [ ] Create workspace → Save → Close browser → Reopen → Verify tab state restored
- [ ] Create workspace → Add tabs → Close browser → Reopen → Verify all tabs restored
- [ ] Create workspace → Switch tabs → Close browser → Reopen → Verify correct tab active
- [ ] Create workspace → URL has workspace param → Load → Verify tab created correctly

---

## Stress Testing

### 17. Performance
- [ ] Create workspace with 100 tool windows → Save → Measure time
- [ ] Create workspace with 100 tool windows → Load → Measure time
- [ ] Create workspace with 100 connections → Save → Measure time
- [ ] Create workspace with 100 connections → Load → Measure time
- [ ] Rapidly switch tabs 20 times → Verify no performance degradation

### 18. Memory
- [ ] Create workspace with large outputs → Save → Monitor memory usage
- [ ] Load workspace with large outputs → Monitor memory usage
- [ ] Create 10 tabs → Each with large workspace → Monitor memory usage
- [ ] Load workspace → Unload → Load again → Verify no memory leaks

### 19. Concurrency
- [ ] Open workspace in 5 browser tabs simultaneously → Make changes in each → Verify no conflicts
- [ ] Save workspace → Immediately open in new tab → Verify consistency
- [ ] Load workspace → Make changes → Save → Load in another tab → Verify updates

---

## Integration Testing

### 20. Tool Execution
- [ ] Create workspace → Execute tool → Save → Load → Verify output preserved
- [ ] Create workspace → Execute tool → Switch tabs → Switch back → Verify output preserved
- [ ] Create workspace → Execute tool → Save → Reload page → Verify output preserved
- [ ] Create workspace → Execute spell → Save → Load → Verify spell state preserved

### 21. Connection System
- [ ] Create workspace with connections → Save → Load → Verify connections work
- [ ] Create workspace → Connect tools → Save → Load → Verify connections restored
- [ ] Create workspace → Delete connection → Save → Load → Verify connection removed
- [ ] Create workspace → Connect → Delete source tool → Save → Load → Verify handling

### 22. Parameter Mappings
- [ ] Create workspace → Map parameters → Save → Load → Verify mappings preserved
- [ ] Create workspace → Map parameters → Switch tabs → Switch back → Verify mappings intact
- [ ] Create workspace → Map parameters → Delete source tool → Load → Verify handling

---

## Browser-Specific Testing

### 23. Cross-Browser
- [ ] Test in Chrome → Save → Load in Firefox → Verify compatibility
- [ ] Test in Safari → Verify localStorage handling
- [ ] Test in Edge → Verify all features work
- [ ] Test in mobile browser → Verify UI works

### 24. Browser Features
- [ ] Test with localStorage disabled → Verify error handling
- [ ] Test with cookies disabled → Verify CSRF token handling
- [ ] Test with JavaScript disabled → Verify graceful degradation
- [ ] Test with ad blockers → Verify no false positives

---

## Security Testing

### 25. Authorization
- [ ] Create workspace → Share URL → Load as different user → Verify access
- [ ] Create private workspace → Share URL → Load as different user → Verify blocked
- [ ] Create workspace → Update as owner → Verify success
- [ ] Create workspace → Try to update as different user → Verify forbidden
- [ ] Create anonymous workspace → Try to update → Verify allowed

### 26. CSRF Protection
- [ ] Save workspace → Verify CSRF token used
- [ ] Save workspace → Remove CSRF token → Verify error
- [ ] Save workspace → Use invalid CSRF token → Verify error
- [ ] Load workspace → Verify no CSRF needed (GET request)

### 27. Input Validation
- [ ] Try to save workspace with XSS in name → Verify sanitization
- [ ] Try to save workspace with SQL injection → Verify handling
- [ ] Try to save workspace with invalid JSON → Verify validation
- [ ] Try to load workspace with malicious slug → Verify sanitization

---

## Regression Testing

### 28. Previously Fixed Issues
- [ ] Test tab switching autosave (previously broken)
- [ ] Test race conditions (previously broken)
- [ ] Test error messages (previously generic)
- [ ] Test tool reconstruction (previously failed silently)
- [ ] Test slug collision (previously possible)

### 29. Known Edge Cases
- [ ] Test workspace with 0 tool windows but connections → Verify handling
- [ ] Test workspace with tool windows but 0 connections → Verify handling
- [ ] Test workspace with invalid tool IDs → Verify graceful degradation
- [ ] Test workspace with circular connections → Verify no infinite loops

---

## Automated Test Scenarios (For Future Implementation)

### 30. Unit Tests Needed
- [ ] `validateSnapshot()` with valid/invalid snapshots
- [ ] `buildSnapshot()` with various window types
- [ ] `hydrateSnapshot()` with valid/invalid data
- [ ] `saveWorkspace()` with various error conditions
- [ ] `loadWorkspace()` with various error conditions
- [ ] `retryWithBackoff()` with simulated failures
- [ ] `queueWorkspaceOperation()` with concurrent operations

### 31. Integration Tests Needed
- [ ] Complete save → load cycle
- [ ] Tab switching with autosave
- [ ] Concurrent save/load operations
- [ ] Network failure recovery
- [ ] Large workspace handling

---

## Test Data Setup

### Workspace Templates to Create

1. **Minimal Workspace**
   - 1 tool window
   - 0 connections
   - Small output

2. **Standard Workspace**
   - 5 tool windows
   - 3 connections
   - Mixed outputs

3. **Complex Workspace**
   - 20 tool windows
   - 15 connections
   - Multiple spell windows
   - Large outputs

4. **Edge Case Workspaces**
   - Workspace with only connections (no tools)
   - Workspace with only tools (no connections)
   - Workspace with deleted tools
   - Workspace with private spells
   - Workspace at size limit

---

## How to Report Issues

When you find an issue, document:

1. **Steps to Reproduce**
   - Exact steps taken
   - Expected behavior
   - Actual behavior

2. **Environment**
   - Browser and version
   - OS
   - Network conditions

3. **Console Logs**
   - Any errors in browser console
   - Network request/response details

4. **Screenshots**
   - Visual evidence of the issue

5. **Workspace State**
   - Workspace slug (if saved)
   - Number of tools/windows
   - Any special characteristics

---

## Priority Testing Order

### High Priority (Test First)
1. Basic save/load flow (#1)
2. Tab system (#2)
3. Concurrent operations (#8)
4. Network failures (#7)
5. Error messages (#15)

### Medium Priority
6. Large workspace (#5)
7. Missing resources (#6)
8. State corruption (#10)
9. Tool matching (#12)
10. Performance (#17)

### Low Priority (Nice to Have)
11. Cross-browser (#23)
12. Security (#25-27)
13. Stress testing (#17-19)

---

## Quick Test Checklist

**5-Minute Smoke Test:**
- [ ] Create workspace → Save → Load → Works?
- [ ] Add tab → Switch back → Works intact?
- [ ] Save → Copy URL → Open in new tab → Loads?

**15-Minute Basic Test:**
- [ ] All of smoke test
- [ ] Test with 10+ tools
- [ ] Test with connections
- [ ] Test error scenarios (empty, invalid ID)

**30-Minute Comprehensive Test:**
- [ ] All of basic test
- [ ] Test tab system thoroughly
- [ ] Test concurrent operations
- [ ] Test network failures
- [ ] Test large workspace

---

## Tips for Finding Edge Cases

1. **Think Like a User**
   - What would a confused user do?
   - What if they click buttons rapidly?
   - What if they close browser mid-save?

2. **Think Like an Attacker**
   - What if they send invalid data?
   - What if they try to access others' workspaces?
   - What if they manipulate localStorage?

3. **Think Like a Developer**
   - What if resources are deleted?
   - What if API is slow/down?
   - What if browser storage is full?

4. **Think About Edge Cases**
   - Empty states
   - Maximum sizes
   - Boundary conditions
   - Race conditions

---

## Success Criteria

A workspace system is reliable if:

✅ **No Data Loss**
- Workspaces save correctly
- Workspaces load correctly
- Tab switching preserves state

✅ **Graceful Error Handling**
- All errors show user-friendly messages
- No silent failures
- Users can recover from errors

✅ **Performance**
- Large workspaces load in < 5 seconds
- Tab switching is instant
- No UI freezing

✅ **Reliability**
- No race conditions
- No state corruption
- Consistent behavior

---

**Happy Testing!** 🧪

