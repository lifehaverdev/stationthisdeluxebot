import executionClient from '../executionClient.js';
import { generationIdToWindowMap, generationCompletionManager, registerWebSocketHandlers } from '../node/websocketHandlers.js';
import { renderResultContent } from '../node/resultContent.js';
import { bindPromptFieldOverlays } from '../node/overlays/textOverlay.js';

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
  const saveBtn=document.createElement('button');saveBtn.textContent='💾';saveBtn.title='Save';saveBtn.style.marginRight='4px';
  const refreshBtn=document.createElement('button');refreshBtn.textContent='⟳';refreshBtn.title='Refresh';refreshBtn.style.marginRight='4px';
  const closeBtn=document.createElement('button');closeBtn.textContent='×';closeBtn.title='Close';
  btnGroup.append(saveBtn,refreshBtn,closeBtn);
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
  const catConfigByName={};
  const selects={};
  categories.forEach(cat=>{
    catConfigByName[cat.name]=cat;
    const row=document.createElement('div');row.style.marginBottom='4px';
    const label=document.createElement('label');label.textContent=cat.name;label.style.marginRight='6px';
    if(cat.mode==='generated' && cat.generator && cat.generator.type==='range'){
      const inp=document.createElement('input');
      inp.type='number';
      if(typeof cat.generator.start==='number') inp.min=String(cat.generator.start);
      if(typeof cat.generator.end==='number') inp.max=String(cat.generator.end);
      if(typeof cat.generator.step==='number') inp.step=String(cat.generator.step||1);
      inp.placeholder=`${cat.generator.start??''}..${cat.generator.end??''}`;
      selects[cat.name]=inp;
      row.append(label,inp);
    } else {
      const sel=document.createElement('select');
      sel.innerHTML=`<option value="">(random)</option>`+(cat.traits||[]).map(t=>`<option value="${t.value!==undefined?t.value:t.name}">${t.name}</option>`).join('');
      selects[cat.name]=sel;
      row.append(label,sel);
    }
    form.appendChild(row);
  });
  win.appendChild(form);

  // ---- Parameter sections (required / optional) ----
  const paramsWrap=document.createElement('div');
  paramsWrap.style.marginTop='8px';
  const requiredSection=document.createElement('div');
  requiredSection.className='required-params';
  const optionalSection=document.createElement('div');
  optionalSection.className='optional-params';
  optionalSection.style.display='none';
  const showMoreBtn=document.createElement('button');
  showMoreBtn.textContent='show more';
  showMoreBtn.className='show-more-button';
  let isExpanded=false;
  showMoreBtn.addEventListener('click',()=>{
    isExpanded=!isExpanded;optionalSection.style.display=isExpanded?'flex':'none';
    showMoreBtn.textContent=isExpanded?'show less':'show more';
    showMoreBtn.classList.toggle('active',isExpanded);
  });
  paramsWrap.append(requiredSection,showMoreBtn,optionalSection);
  win.appendChild(paramsWrap);

  // Build parameter inputs from tool schema
  (async()=>{
    try{
      const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(collection.toolId)}`);
      if(res.ok){toolDefCache=await res.json();}
    }catch(e){console.warn('tool def fetch fail',e);}
    const overrides=collection.config?.paramOverrides||collection.paramOverrides||{};
    const inputSchema=toolDefCache?.inputSchema||{};
    const entries=Object.entries(inputSchema).reduce((acc,[key,def])=>{
      if(def?.required){acc.required.push([key,def]);} else {acc.optional.push([key,def]);}
      return acc;
    },{required:[],optional:[]});

    function createParamInput(key,def){
      const container=document.createElement('div');
      container.className='parameter-input';
      container.dataset.paramName=key;
      const label=document.createElement('label');
      label.textContent=def?.name||key;
      const input=document.createElement('input');
      input.type=(def?.type==='number'||def?.type==='integer')?'number':'text';
      const defaultVal=(def&&def.default!==undefined)?def.default:'';
      const startVal=(overrides[key]!==undefined)?overrides[key]:defaultVal;
      input.value=startVal;
      input.name=key;
      input.placeholder=def?.description||label.textContent;
      container.append(label,input);
      return container;
    }

    entries.required.forEach(([k,d])=>{requiredSection.appendChild(createParamInput(k,d));});
    entries.optional.forEach(([k,d])=>{optionalSection.appendChild(createParamInput(k,d));});

    // Bind text overlays for prompt-like fields
    try{bindPromptFieldOverlays();}catch(e){console.warn('bindPromptFieldOverlays failed',e);}
  })();

  const btnRow=document.createElement('div');btnRow.style.marginTop='8px';
  const randBtn=document.createElement('button');randBtn.textContent='🎲';
  const execBtn=document.createElement('button');execBtn.textContent='Execute';execBtn.style.marginLeft='8px';
  btnRow.append(randBtn,execBtn);win.appendChild(btnRow);

  const outputDiv=document.createElement('div');outputDiv.style.marginTop='10px';win.appendChild(outputDiv);

  // Save handler (persist paramOverrides)
  saveBtn.onclick=async()=>{
    try{
      const inputs=paramsWrap.querySelectorAll('.parameter-input input');
      const overrides={};
      inputs.forEach(inp=>{overrides[inp.name]=inp.type==='number'?Number(inp.value):inp.value;});
      // get CSRF token if available
      let csrf='';
      try{const t=await fetch('/api/v1/csrf-token',{credentials:'include'});if(t.ok){const j=await t.json();csrf=j.csrfToken||'';}}catch(x){}
      const res=await fetch(`/api/v1/collections/${encodeURIComponent(collection.collectionId)}`,{method:'PUT',headers:{'Content-Type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})},credentials:'include',body:JSON.stringify({ 'config.paramOverrides': overrides })});
      if(!res.ok){throw new Error('save failed');}
      outputDiv.textContent='Saved overrides';
      // optional: refresh to load persisted state
      refreshBtn.onclick();
    }catch(e){outputDiv.textContent='Save failed';}
  };

  randBtn.onclick=()=>{
    categories.forEach(cat=>{
      const el=selects[cat.name];
      if(!el) return;
      if(el.tagName==='SELECT'){
        const options=Array.from(el.options).slice(1); // exclude random option
        if(options.length){
          const rndOpt=options[Math.floor(Math.random()*options.length)];
          el.value=rndOpt.value;
        }
      } else if(el.type==='number'){
        const gen=catConfigByName[cat.name]?.generator||{};
        const start=Number.isFinite(gen.start)?gen.start:0;
        const end=Number.isFinite(gen.end)?gen.end:start;
        const step=Number.isFinite(gen.step)&&gen.step>0?gen.step:1;
        const rangeCount=Math.floor((end-start)/step)+1;
        const idx=Math.floor(Math.random()*rangeCount);
        el.value=String(start+idx*step);
      }
    });
  };

  execBtn.onclick=async()=>{
    outputDiv.textContent='Running…';
    const traitSel={};
    categories.forEach(cat=>{
      const el=selects[cat.name];
      if(!el) return;
      const v=(el.tagName==='SELECT')?el.value:el.value;
      if(v!=='' && v!==undefined) traitSel[cat.name]=el.type==='number'?Number(v):v;
    });
    // Gather current parameter values from inputs
    const paramOverrides={};
    const allInputs=paramsWrap.querySelectorAll('.parameter-input input');
    allInputs.forEach(inp=>{paramOverrides[inp.name]=inp.type==='number'?Number(inp.value):inp.value;});
    // auto-randomise any not chosen
    categories.forEach(cat=>{
      if(traitSel[cat.name]!==undefined) return;
      if(cat.mode==='generated' && cat.generator && cat.generator.type==='range'){
        const gen=cat.generator;
        const start=Number.isFinite(gen.start)?gen.start:0;
        const end=Number.isFinite(gen.end)?gen.end:start;
        const step=Number.isFinite(gen.step)&&gen.step>0?gen.step:1;
        const rangeCount=Math.floor((end-start)/step)+1;
        const idx=Math.floor(Math.random()*rangeCount);
        traitSel[cat.name]=start+idx*step;
      } else if(cat.traits?.length){
        const rand=cat.traits[Math.floor(Math.random()*cat.traits.length)];
        traitSel[cat.name]=rand?.value||rand?.name||'';
      }
    });

    // --- Ensure tool definition loaded for defaults ---
    if(!toolDefCache){try{const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(collection.toolId)}`);if(res.ok){toolDefCache=await res.json();}}catch(e){console.warn('tool def fetch fail',e);} }
    const defaults={};
    if(toolDefCache&&toolDefCache.inputSchema){Object.entries(toolDefCache.inputSchema).forEach(([key,def])=>{if(def.default!==undefined){defaults[key]=def.default;}else{defaults[key]='';}})}

    // Substitute trait values into overrides
    const substituted={};
    Object.entries(paramOverrides).forEach(([k,v])=>{
      let val=v;
      if(typeof val==='string'){
        Object.entries(traitSel).forEach(([catName,catVal])=>{
          const cat=catConfigByName[catName];
          let replacement=catVal;
          if(cat && cat.mode==='generated' && cat.generator && typeof catVal==='number'){
            const zp=Number(cat.generator.zeroPad)||0;
            replacement=zp>0?String(catVal).padStart(zp,'0'):String(catVal);
          }
          replacement=String(replacement);
          val=val.replaceAll(`[[${catName}]]`,replacement).replaceAll(`[[${catName.toLowerCase()}]]`,replacement);
        });
      }
      substituted[k]=val;
    });

    // Validate required params are filled
    const missingRequired=[];
    if(toolDefCache&&toolDefCache.inputSchema){
      Object.entries(toolDefCache.inputSchema).forEach(([key,def])=>{
        if(def?.required){
          const val=substituted[key]!==undefined?substituted[key]:defaults[key];
          if(val===undefined || val===null || val==='') missingRequired.push(def?.name||key);
        }
      });
    }
    if(missingRequired.length){
      outputDiv.textContent=`Missing required: ${missingRequired.join(', ')}`;
      return;
    }

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