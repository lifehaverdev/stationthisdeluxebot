function debounceFn(fn, wait=300){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}

// --- WebSocket live updates ---
const ws = window.websocketClient;
let lastRunTimestamp = 0;
if(ws){
  ws.on('generationUpdate', payload=>{
     // Only react to updates after the last Run click
     if(Date.now() - lastRunTimestamp < 60000){ // 1-min window is enough for small spells
        renderOutput(payload);
     }
  });
  ws.on('generationProgress', payload=>{
     if(Date.now() - lastRunTimestamp < 60000){
        quoteEl.innerHTML = `<p>Progress: ${(payload.progress||0).toFixed(0)}%</p>`;
     }
  });
  ws.on('tool-response', payload=>{
     renderOutput({outputs:payload});
  });
}

const slug = window.location.pathname.split('/').pop();
const metadataEl = document.getElementById('spell-metadata');
const formEl = document.getElementById('input-form');
const quoteEl = document.getElementById('quote-section');
const runBtn = document.getElementById('run-btn');
const outputEl = document.getElementById('output-section');

// Simple helper to fetch CSRF token the first time we need it and cache it
let cachedCsrfToken = null;
async function getCsrfToken(){
  if(cachedCsrfToken) return cachedCsrfToken;
  try{
    const res = await fetch('/api/v1/csrf-token', { credentials:'include' });
    if(res.ok){
      const data = await res.json();
      cachedCsrfToken = data.csrfToken || data.token || data._csrf || null;
    }
  }catch(e){console.warn('Failed to fetch CSRF token:', e);}
  return cachedCsrfToken;
}

let spellMeta = null;
let currentInputs = {};
let currentQuote = null;

async function fetchMetadata(){
  const res = await fetch(`/api/v1/spells/${slug}`);
  if(!res.ok){metadataEl.textContent='Spell not found.';return;}
  spellMeta = await res.json();
  renderMetadata();
  renderForm();
  // Immediately fetch a cost quote once metadata is loaded so the Run button becomes visible,
  // even for spells that have no required inputs.
  fetchQuote();
}

function renderMetadata(){
  metadataEl.innerHTML = `
    <h2>${spellMeta.name}</h2>
    <p>${spellMeta.description||''}</p>
    <p><small>Creator: ${spellMeta.author||'Unknown'}</small></p>`;
}

async function renderForm(){
  const exposed = spellMeta.exposedInputs || [];
  if(exposed.length===0){formEl.innerHTML='<p>No inputs required.</p>'; return;}

  // Simple inline form renderer (no external deps)
  formEl.innerHTML='';
  exposed.forEach(input=>{
     const id = `input-${input.paramKey}`;
     const wrapper=document.createElement('div');
     wrapper.className='form-group';
     wrapper.innerHTML=`<label for="${id}">${input.paramKey}</label><input id="${id}" type="text" data-param="${input.paramKey}" class="form-control" />`;
     wrapper.querySelector('input').addEventListener('input', debounceFn(updateInputs,300));
     formEl.appendChild(wrapper);
  });
}

function updateInputs(){
  const inputs=formEl.querySelectorAll('input');
  currentInputs={};
  inputs.forEach(inp=>{currentInputs[inp.dataset.param]=inp.value;});
  fetchQuote();
}

async function fetchQuote(){
  if(!spellMeta) return;
  const csrfToken = await getCsrfToken();
  const res = await fetch(`/api/v1/spells/${spellMeta._id}/quote`,{
      method:'POST',
      headers:{'Content-Type':'application/json', 'x-csrf-token': csrfToken || ''},
      credentials:'include',
      body:JSON.stringify({ sampleSize:10 })
  });
  if(!res.ok){return;}
  currentQuote = await res.json();
  quoteEl.style.display='block';
  quoteEl.innerHTML=`<h3>Estimated Cost</h3><p>${currentQuote.totalCostPts.toFixed(0)} pts</p>`;
  runBtn.style.display='inline-block';
}

function renderOutput(genPayload){
  outputEl.style.display='block';
  if(genPayload && genPayload.outputs){
     // Simple rendering: if text field present show text, if image URLs array show images
     if(typeof genPayload.outputs.text==='string'){
        outputEl.textContent = genPayload.outputs.text;
     }else if(Array.isArray(genPayload.outputs.images)){
        outputEl.innerHTML = genPayload.outputs.images.map(src=>`<img src="${src}" />`).join('');
     }else{
        outputEl.textContent = JSON.stringify(genPayload.outputs,null,2);
     }
  }else{
     outputEl.textContent = 'Spell execution completed.';
  }
}

runBtn.addEventListener('click', async ()=>{
  if(!currentQuote) return;
  runBtn.disabled=true;
  runBtn.textContent='Running…';
  outputEl.textContent='';
  lastRunTimestamp = Date.now();
  try{
    // Pre-pay: charge points
    // TODO: implement points charge flow once backend endpoint is ready
    // const chargeRes = await fetch('/api/v1/points/charge', {method:'POST'});
    // Execute spell
    const csrfToken = await getCsrfToken();
    const execRes = await fetch('/api/v1/spells/cast',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-csrf-token': csrfToken || ''},
        credentials:'include',
        body:JSON.stringify({ slug, context:{ parameterOverrides: currentInputs }})
    });
    const data = await execRes.json();
    outputEl.textContent=JSON.stringify(data,null,2);
  }catch(err){outputEl.textContent='Error executing spell.';}
  runBtn.disabled=false; runBtn.textContent='Run Spell';
});

fetchMetadata(); 