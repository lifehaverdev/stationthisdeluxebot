// src/platforms/web/client/src/sandbox/components/WorkspaceTabs.js
import { saveWorkspace, loadWorkspace, loadBlankWorkspace } from '../workspaces.js';
import { initState } from '../state.js';
import { activeToolWindows, connections, selectedNodeIds, persistState } from '../state.js';
import { showNotification } from '../utils/notifications.js';

const EMOJIS = ['🖼️','🎵','📝','🎬','✨','🌟','🚀','🔥','💡','🧪','🧩'];
function pickEmoji(str){
  let hash = 0; for (let i=0;i<str.length;i++) hash = (hash<<5)-hash + str.charCodeAt(i);
  return EMOJIS[Math.abs(hash)%EMOJIS.length];
}

export default function initWorkspaceTabs(container){
  const TABS_KEY='sandbox_workspace_tabs';

  // Save / Load buttons
  const saveBtn=document.createElement('button');
  saveBtn.className='ws-btn ws-save-btn';
  saveBtn.title='Save Workspace';
  saveBtn.textContent='💾';
  saveBtn.onclick=()=>saveWorkspace();

  const loadBtn=document.createElement('button');
  loadBtn.className='ws-btn ws-load-btn';
  loadBtn.title='Load Workspace';
  loadBtn.textContent='📂';
  loadBtn.onclick=async ()=>{
    const slugInput=prompt('Enter workspace ID / URL','');
    if(!slugInput) return;
    const id=slugInput.includes('/')? slugInput.split(/workspace=|\//).pop(): slugInput;
    const loadedSlug = await loadWorkspace(id.trim());
    if(loadedSlug){
      tabs[current].slug = loadedSlug;
      tabs[current].emoji = pickEmoji(loadedSlug);
      persistTabs();
      render();
    }
  };

  // Tabs bar
  const bar=document.createElement('div');
  bar.className='workspace-tabs';

  container.appendChild(saveBtn);
  container.appendChild(loadBtn);
  container.appendChild(bar);

  const tabs=[];
  function render(){
    bar.innerHTML='';
    tabs.forEach((t,idx)=>{
      const btn=document.createElement('button');
      btn.className='ws-tab-btn';
      btn.innerHTML= `<span class="tab-emoji">${t.slug? t.emoji:'❄️'}</span>`+
                      `<span class="tab-close" title="Close">×</span>`;
      btn.style.padding='4px 8px';
      btn.style.border='none';
      btn.style.background= idx===current ? '#ddd':'#aaa';
      btn.style.clipPath='polygon(0% 0%,100% 0%,100% 80%,90% 100%,10% 100%,0% 80%)';
      btn.querySelector('.tab-emoji').onclick=(e)=>{e.stopPropagation();switchTab(idx);} // switch
      btn.querySelector('.tab-close').onclick=(e)=>{e.stopPropagation();closeTab(idx);} // close
      bar.appendChild(btn);
    });
    const add=document.createElement('button');
    add.textContent='+';
    add.style.padding='4px 8px';
    add.style.border='none';
    add.style.background='#888';
    add.style.clipPath='polygon(0% 0%,100% 0%,100% 80%,90% 100%,10% 100%,0% 80%)';
    add.onclick=()=>addTab();
    bar.appendChild(add);
  }
  let current=0;
  let switchingInProgress = false;
  
  async function switchTab(idx){
    if(idx===current) return;
    if(switchingInProgress) {
      console.warn('[WorkspaceTabs] Tab switch already in progress');
      return;
    }
    
    switchingInProgress = true;
    
    try {
      // autosave current (silent, but handle failures)
      try {
        const newSlug = await saveWorkspace(tabs[current].slug || null,{silent:true});
        if (!tabs[current].slug && newSlug) {
          tabs[current].slug = newSlug;
          tabs[current].emoji = pickEmoji(newSlug);
        }
      } catch (e) {
        // Autosave failed - warn user but continue with switch
        console.error('[WorkspaceTabs] Autosave failed during tab switch:', e);
        showNotification('Warning: Could not save current workspace before switching tabs.', 'warning', 5000);
      }
      
      persistTabs();
      current=idx;
      persistTabs();
      
      const t=tabs[idx];
      if(t.slug) {
        try {
          await loadWorkspace(t.slug, { silent: true });
        } catch (e) {
          console.error('[WorkspaceTabs] Failed to load workspace:', e);
          showNotification(`Failed to load workspace: ${e.message}`, 'error');
          // Reset to blank on load failure
          resetToBlank();
        }
      } else {
        resetToBlank();
        const url=new URL(window.location.href);
        url.searchParams.delete('workspace');
        window.history.pushState({},'',url);
      }
    } finally {
      switchingInProgress = false;
    }
  }
  async function addTab(){
    // Save current workspace before adding new tab
    // switchTab will handle saving, then we switch to the new blank tab
    const newTabIndex = tabs.length;
    tabs.push({slug:null,emoji:'🆕'});
    render();
    // Switch to new tab (this will save current workspace first, then load blank)
    await switchTab(newTabIndex);
  }

  function persistTabs(){
    localStorage.setItem(TABS_KEY,JSON.stringify({tabs,current}));
  }

  function restoreTabs(){
    try{
      const raw=localStorage.getItem(TABS_KEY);
      if(!raw) return false;
      const obj=JSON.parse(raw);
      if(Array.isArray(obj.tabs)){
        tabs.splice(0,tabs.length,...obj.tabs);
        current=obj.current||0;
        return true;
      }
    }catch{}
    return false;
  }

  function resetToBlank(){
    // Clear persisted snapshot first
    localStorage.removeItem('sandbox_connections');
    localStorage.removeItem('sandbox_tool_windows');

    // Clear in-memory state (avoid initState side-effects)
    activeToolWindows.length = 0;
    connections.length = 0;
    selectedNodeIds.clear();

    // Persist truly blank state so future reloads remain empty
    try { persistState(); } catch {}

    // Remove existing elements from DOM for immediate blank canvas
    document.querySelectorAll('.tool-window, .connection-line').forEach(el=>el.remove());
  }

  async function closeTab(idx){
    // Prevent closing last tab
    if(tabs.length===1) return;
    
    // If closing current tab, try to save first
    if(idx === current) {
      try {
        await saveWorkspace(tabs[current].slug || null, {silent:true});
      } catch (e) {
        console.error('[WorkspaceTabs] Autosave failed before closing tab:', e);
        // Continue anyway - user explicitly closed tab
      }
    }
    
    tabs.splice(idx,1);
    // Adjust current index
    if(current>=idx) current=Math.max(0,current-1);
    render();
    persistTabs();
    
    // Activate new current tab view
    const cur=tabs[current];
    if(cur && cur.slug) {
      try {
        await loadWorkspace(cur.slug, { silent: true });
      } catch (e) {
        console.error('[WorkspaceTabs] Failed to load workspace after tab close:', e);
        showNotification(`Failed to load workspace: ${e.message}`, 'error');
        resetToBlank();
      }
    } else {
      resetToBlank();
    }
  }

  // initial tab from URL param
  const url=new URL(window.location.href);
  const slug=url.searchParams.get('workspace');
  if(!restoreTabs()){
    tabs.push({slug,emoji: slug? pickEmoji(slug):'🆗'});
    current=0;
  }
  render();
  persistTabs();

  // If first tab has a slug (coming from ?workspace=) load it immediately for guests
  if(tabs[0] && tabs[0].slug){
    loadWorkspace(tabs[0].slug, { silent: true }).catch(e => {
      console.error('[WorkspaceTabs] Failed to load initial workspace:', e);
      showNotification(`Failed to load workspace: ${e.message}`, 'error');
    });
  }

  // Listen for external snapshot updates to refresh canvas without losing tabs
  window.addEventListener('sandboxSnapshotUpdated',()=>{
    // No-op here; index.js will redraw canvas, but tabs remain.
  });
}
