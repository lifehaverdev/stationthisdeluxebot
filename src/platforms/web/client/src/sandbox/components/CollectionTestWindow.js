import executionClient from '../executionClient.js';
import { generationIdToWindowMap, generationCompletionManager, registerWebSocketHandlers } from '../node/websocketHandlers.js';
import { renderResultContent } from '../node/resultContent.js';

export function createCollectionTestWindow(collection, position={x:200,y:100}){
  if(typeof registerWebSocketHandlers==='function' && !window._cookTestWsReg){registerWebSocketHandlers();window._cookTestWsReg=true;}
  const win=document.createElement('div');
  win.className='test-window tool-window';
  win.style.left=`${position.x}px`;win.style.top=`${position.y}px`;
  win.style.width='300px';
  win.style.background='#1a1a1a';win.style.color='#fff';win.style.padding='10px';win.style.border='1px solid #444';win.style.borderRadius='8px';

  const header=document.createElement('div');
  header.textContent=`${collection.name||'Collection'} · Test`;
  header.style.fontWeight='bold';header.style.marginBottom='6px';header.style.cursor='move';header.style.userSelect='none';
  header.style.display='flex';header.style.justifyContent='space-between';
  const btnGroup=document.createElement('div');
  const refreshBtn=document.createElement('button');refreshBtn.textContent='⟳';refreshBtn.title='Refresh';refreshBtn.style.marginRight='4px';
  const closeBtn=document.createElement('button');closeBtn.textContent='×';closeBtn.title='Close';
  btnGroup.append(refreshBtn,closeBtn);
  header.appendChild(btnGroup);
  win.appendChild(header);

  closeBtn.onclick=()=>{win.remove();};
  refreshBtn.onclick=async()=>{
    try{const res=await fetch(`/api/v1/collections/${encodeURIComponent(collection.collectionId)}`);if(res.ok){const latest=await res.json();const pos={x:win.offsetLeft,y:win.offsetTop};win.remove();createCollectionTestWindow(latest,pos);} }catch(e){console.warn('refresh fail',e);} };

  // Simple drag via header
  let dragOff={x:0,y:0},dragging=false;
  header.addEventListener('mousedown',e=>{dragging=true;dragOff.x=e.clientX-win.offsetLeft;dragOff.y=e.clientY-win.offsetTop;header.style.cursor='grabbing';});
  document.addEventListener('mousemove',e=>{if(dragging){win.style.left=`${e.clientX-dragOff.x}px`;win.style.top=`${e.clientY-dragOff.y}px`;}});
  document.addEventListener('mouseup',()=>{if(dragging){dragging=false;header.style.cursor='move';}});

  const form=document.createElement('div');
  let toolDefCache=null;
  const categories=collection.config?.traitTree||[];
  const selects={};
  categories.forEach(cat=>{
    const row=document.createElement('div');row.style.marginBottom='4px';
    const label=document.createElement('label');label.textContent=cat.name;label.style.marginRight='6px';
    const sel=document.createElement('select');
    sel.innerHTML=`<option value="">(random)</option>`+cat.traits.map(t=>`<option value="${t.value!==undefined?t.value:t.name}">${t.name}</option>`).join('');
    selects[cat.name]=sel;
    row.append(label,sel);form.appendChild(row);
  });
  win.appendChild(form);

  const btnRow=document.createElement('div');btnRow.style.marginTop='8px';
  const randBtn=document.createElement('button');randBtn.textContent='🎲';
  const execBtn=document.createElement('button');execBtn.textContent='Execute';execBtn.style.marginLeft='8px';
  btnRow.append(randBtn,execBtn);win.appendChild(btnRow);

  const outputDiv=document.createElement('div');outputDiv.style.marginTop='10px';win.appendChild(outputDiv);

  randBtn.onclick=()=>{
    categories.forEach(cat=>{
      const sel=selects[cat.name];
      const options=Array.from(sel.options).slice(1); // exclude random option
      if(options.length){
        const rndOpt=options[Math.floor(Math.random()*options.length)];
        sel.value=rndOpt.value;
      }
    });
  };

  execBtn.onclick=async()=>{
    outputDiv.textContent='Running…';
    const traitSel={};
    categories.forEach(cat=>{const v=selects[cat.name].value;if(v) traitSel[cat.name]=v;});
    const paramOverrides={...(collection.paramOverrides||collection.config?.paramOverrides||{})};
    // auto-randomise any not chosen
    categories.forEach(cat=>{if(!traitSel[cat.name]&&cat.traits?.length){const rand=cat.traits[Math.floor(Math.random()*cat.traits.length)];traitSel[cat.name]=rand?.value||rand?.name||'';}});

    // --- Ensure tool definition loaded for defaults ---
    if(!toolDefCache){try{const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(collection.toolId)}`);if(res.ok){toolDefCache=await res.json();}}catch(e){console.warn('tool def fetch fail',e);} }
    const defaults={};
    if(toolDefCache&&toolDefCache.inputSchema){Object.entries(toolDefCache.inputSchema).forEach(([key,def])=>{if(def.default!==undefined){defaults[key]=def.default;}else{defaults[key]='';}});} 

    // Substitute trait values into overrides
    const substituted={};
    Object.entries(paramOverrides).forEach(([k,v])=>{
      let val=v;
      if(typeof val==='string'){
        Object.entries(traitSel).forEach(([catName,catVal])=>{
          val=val.replaceAll(`[[${catName}]]`,catVal).replaceAll(`[[${catName.toLowerCase()}]]`,catVal);
        });
      }
      substituted[k]=val;
    });

    const inputs={...defaults,...substituted};

    // Progress UI
    let progressIndicator=win.querySelector('.progress-indicator');
    if(!progressIndicator){progressIndicator=document.createElement('div');progressIndicator.className='progress-indicator';win.appendChild(progressIndicator);} 
    progressIndicator.textContent='Executing…';

    try{
      const payload={toolId:collection.toolId,inputs,metadata:{platform:'cook-test'}};
      const execResult=await executionClient.execute(payload);

      if(execResult.generationId && !execResult.final){
        generationIdToWindowMap[execResult.generationId]=win;
        progressIndicator.textContent=`Status: ${execResult.status}`;
        await generationCompletionManager.createCompletionPromise(execResult.generationId);
        // result will render via websocket handler which removes indicator
      }else{
        if(progressIndicator) progressIndicator.remove();

        let outputData;
        if(Array.isArray(execResult.outputs?.images) && execResult.outputs.images[0]?.url){outputData={type:'image',url:execResult.outputs.images[0].url};}
        else if(execResult.outputs?.imageUrl){outputData={type:'image',url:execResult.outputs.imageUrl};}
        else if(execResult.outputs?.response){outputData={type:'text',text:execResult.outputs.response};}
        else if(execResult.outputs?.text){outputData={type:'text',text:execResult.outputs.text};}
        else {outputData={type:'unknown',...execResult.outputs};}

        outputDiv.innerHTML='';
        if(!outputDiv.classList.contains('result-container')) outputDiv.classList.add('result-container');
        renderResultContent(outputDiv,outputData);
      }
    }catch(e){
      if(progressIndicator) progressIndicator.remove();
      outputDiv.textContent=e.message||'error';
    }
  };

  document.querySelector('.sandbox-canvas')?.appendChild(win);
} 