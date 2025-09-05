// src/platforms/web/client/src/sandbox/components/WorkspaceTabs.js
import { saveWorkspace, loadWorkspace } from '../workspaces.js';

const EMOJIS = ['🖼️','🎵','📝','🎬','✨','🌟','🚀','🔥','💡','🧪','🧩'];
function pickEmoji(str){
  let hash = 0; for (let i=0;i<str.length;i++) hash = (hash<<5)-hash + str.charCodeAt(i);
  return EMOJIS[Math.abs(hash)%EMOJIS.length];
}

export default function initWorkspaceTabs(container){
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
  loadBtn.onclick=()=>{
    const slug=prompt('Enter workspace ID / URL','');
    if(!slug) return;
    const id=slug.includes('/')? slug.split(/workspace=|\//).pop(): slug;
    loadWorkspace(id.trim());
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
      btn.textContent= t.slug? `${t.emoji}`: '❄️';
      btn.title= t.slug || 'Unsaved';
      btn.style.padding='4px 8px';
      btn.style.border='none';
      btn.style.background= idx===current ? '#ddd':'#aaa';
      btn.style.clipPath='polygon(0% 0%,100% 0%,100% 80%,90% 100%,10% 100%,0% 80%)';
      btn.onclick=()=>switchTab(idx);
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
  async function switchTab(idx){
    if(idx===current) return;
    // autosave current
    await saveWorkspace();
    current=idx;
    const t=tabs[idx];
    if(t.slug) await loadWorkspace(t.slug);
    else {
      // clear state by reloading without snapshot
      localStorage.removeItem('sandbox_connections');
      localStorage.removeItem('sandbox_tool_windows');
      window.location.reload();
    }
  }
  function addTab(){
    tabs.push({slug:null,emoji:'🆕'});
    render();
    switchTab(tabs.length-1);
  }
  // initial tab from URL param
  const url=new URL(window.location.href);
  const slug=url.searchParams.get('workspace');
  tabs.push({slug,emoji: slug? pickEmoji(slug):'🆗'});
  render();

  // bar already appended via container.append above
}
