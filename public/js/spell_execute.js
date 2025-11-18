function debounceFn(fn, wait=300){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}

// --- WebSocket live updates ---
let ws = null;
let wsConnected = false; // Track WebSocket connection state
let lastRunTimestamp = 0;
let currentCastId = null; // Track current spell execution castId
let pollingInterval = null; // Polling fallback for non-authenticated users

// Check if user is authenticated (has JWT or guestToken cookie)
function isAuthenticated() {
  // Check if JWT or guestToken cookie exists
  const cookies = document.cookie.split(';');
  return cookies.some(cookie => {
    const trimmed = cookie.trim();
    return trimmed.startsWith('jwt=') || trimmed.startsWith('guestToken=');
  });
}

// Initialize WebSocket connection (only if authenticated)
function initializeWebSocket(skipAuthCheck = false) {
  // Wait for websocketClient to be available (it's loaded as a module)
  if (!window.websocketClient) {
    // Retry after a short delay (max 5 seconds)
    if (!window._wsInitAttempts) window._wsInitAttempts = 0;
    window._wsInitAttempts++;
    if (window._wsInitAttempts < 50) { // 5 seconds max
      setTimeout(() => initializeWebSocket(skipAuthCheck), 100);
      return;
    } else {
      console.warn('[SpellPage] websocketClient not available after 5 seconds, giving up');
      return;
    }
  }

  // Only connect if user is authenticated (has JWT cookie) - unless skipAuthCheck is true
  if (!skipAuthCheck && !isAuthenticated()) {
    console.log('[SpellPage] User not authenticated, skipping WebSocket connection. Will use polling for updates.');
    return;
  }

  ws = window.websocketClient;
  if (!ws) {
    console.warn('[SpellPage] websocketClient not available');
    return;
  }

  // Register WebSocket event handlers BEFORE connecting
  ws.off('open'); // Remove existing if any
  ws.on('open', () => {
    console.log('[SpellPage] WebSocket connection opened');
    wsConnected = true;
    stopPolling(); // Stop polling when WebSocket connects
  });
  
  ws.off('close');
  ws.on('close', () => {
    console.warn('[SpellPage] WebSocket connection closed');
    wsConnected = false;
    // If we have an active cast, restart polling as fallback
    if (currentCastId && !pollingInterval) {
      console.log('[SpellPage] WebSocket disconnected, starting polling fallback');
      startPollingForResults(currentCastId);
    }
  });
  
  ws.off('error');
  ws.on('error', (error) => {
    console.error('[SpellPage] WebSocket error:', error);
    wsConnected = false;
  });

  // Register WebSocket event handlers for spell updates
  ws.off('generationUpdate', handleGenerationUpdate); // Remove existing if any
  ws.on('generationUpdate', handleGenerationUpdate);
  ws.off('generationProgress', handleGenerationProgress);
  ws.on('generationProgress', handleGenerationProgress);
  ws.off('tool-response', handleToolResponse);
  ws.on('tool-response', handleToolResponse);

  // Connect WebSocket if not already connected
  if (typeof ws.connect === 'function') {
    try {
      ws.connect();
      console.log('[SpellPage] WebSocket connection initiated');
      
      // Check connection status after a short delay
      setTimeout(() => {
        if (window.websocketClient && window.websocketClient.socket) {
          const socket = window.websocketClient.socket;
          if (socket.readyState === WebSocket.OPEN) {
            wsConnected = true;
            console.log('[SpellPage] WebSocket confirmed connected');
          } else {
            console.log('[SpellPage] WebSocket state:', socket.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
          }
        }
      }, 1000);
    } catch (error) {
      console.error('[SpellPage] Failed to connect WebSocket:', error);
      wsConnected = false;
    }
  } else {
    console.warn('[SpellPage] websocketClient.connect is not a function');
    wsConnected = false;
  }
}

// Connect WebSocket after authentication (e.g., after guest token is set)
function connectWebSocketAfterAuth(skipAuthCheck = false) {
  // If skipAuthCheck is true, we trust that the caller verified authentication (e.g., fetchUserAccount succeeded)
  if (!skipAuthCheck && !isAuthenticated()) {
    console.log('[SpellPage] connectWebSocketAfterAuth: User not authenticated yet');
    return; // Not authenticated yet
  }
  
  // If WebSocket already exists and is connected, we're good
  if (ws && wsConnected) {
    console.log('[SpellPage] WebSocket already connected');
    stopPolling(); // Stop polling if WebSocket is working
    return;
  }
  
  console.log('[SpellPage] User authenticated, connecting WebSocket...');
  // Skip auth check since we already verified authentication
  initializeWebSocket(true);
  
  // Also check after a delay to ensure connection succeeded
  setTimeout(() => {
    if (!wsConnected && currentCastId) {
      console.log('[SpellPage] WebSocket connection may have failed, ensuring polling is active');
      // Don't start polling here - it should already be started by the spell execution flow
    }
  }, 2000);
}

// Set guest token cookie and connect WebSocket
function setGuestTokenAndConnect(guestToken) {
  // Set guest token as cookie
  document.cookie = `guestToken=${guestToken}; path=/; max-age=86400; SameSite=Lax`;
  console.log('[SpellPage] Guest token set, attempting WebSocket connection...');
  
  // Try to connect WebSocket now that we have a token
  connectWebSocketAfterAuth();
}

// Handle generation update (final result)
function handleGenerationUpdate(payload) {
  const { generationId, outputs, status, toolId, spellId, castId } = payload;
  
  // Only process updates for the current spell execution
  if (castId && currentCastId && castId !== currentCastId) {
    console.log(`[SpellPage] Ignoring generationUpdate for castId ${castId} (current: ${currentCastId})`);
    return; // Not for this execution
  }
  
  // Only react to updates after the last Run click
  if (Date.now() - lastRunTimestamp > 60000) {
    console.log(`[SpellPage] Ignoring generationUpdate - too old (${Date.now() - lastRunTimestamp}ms)`);
    return; // Too old
  }

  console.log('[SpellPage] generationUpdate received', { castId, status, toolId, generationId });

  // Stop polling since we got WebSocket update
  stopPolling();

  if (status === 'completed' || status === 'success') {
    console.log('[SpellPage] Rendering completed output for castId:', castId, 'outputs:', JSON.stringify(outputs).substring(0, 200));
    
    // Handle WebSocket outputs format - toWebFormat returns { images: [...] } or { text: "..." } or array format
    let outputsToRender = outputs;
    
    // If outputs is already in the right format (object with images/text), use it directly
    if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
      // Already in correct format: { images: [...] } or { text: "..." }
      outputsToRender = outputs;
    } else if (Array.isArray(outputs) && outputs.length > 0) {
      // Normalized array format: [{ type: 'image', data: { images: [...] } }]
      // Or: [{ data: { images: [{ url: ... }] } }]
      if (outputs[0]?.data?.images && outputs[0].data.images.length > 0) {
        const firstImage = outputs[0].data.images[0];
        const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage.url;
        outputsToRender = { images: [imageUrl] };
      } else if (outputs[0]?.type === 'image' && outputs[0]?.data?.images?.[0]?.url) {
        outputsToRender = { images: [outputs[0].data.images[0].url] };
      } else if (outputs[0]?.type === 'text' && outputs[0]?.data?.text) {
        const text = Array.isArray(outputs[0].data.text) ? outputs[0].data.text[0] : outputs[0].data.text;
        outputsToRender = { text };
      }
    }
    
    console.log('[SpellPage] Normalized outputsToRender:', JSON.stringify(outputsToRender).substring(0, 200));
    renderOutput(outputsToRender, castId);
  } else if (status === 'failed' || status === 'error') {
    outputEl.style.color = '#dc3545';
    outputEl.textContent = `❌ Spell execution failed: ${payload.error || 'Unknown error'}`;
  }
}

// Handle generation progress updates
function handleGenerationProgress(payload) {
  const { progress, status, toolId, castId } = payload;
  
  // Only process updates for the current spell execution
  if (castId && currentCastId && castId !== currentCastId) {
    console.log(`[SpellPage] Ignoring generationProgress for castId ${castId} (current: ${currentCastId})`);
    return;
  }
  
  // Only react to updates after the last Run click
  if (Date.now() - lastRunTimestamp > 60000) {
    return;
  }

  console.log('[SpellPage] generationProgress received', { progress, toolId, castId });

  // Update progress display
  const progressPercent = (progress || 0).toFixed(0);
  if (outputEl) {
    outputEl.style.color = '';
    outputEl.textContent = `⏳ Executing spell... ${progressPercent}%`;
    if (toolId) {
      outputEl.textContent += `\nCurrent step: ${toolId}`;
    }
  }
}

// Handle tool response (immediate tool responses)
function handleToolResponse(payload) {
  const { toolId, output, spellId, castId } = payload;
  
  // Only process updates for the current spell execution
  if (castId && currentCastId && castId !== currentCastId) {
    console.log(`[SpellPage] Ignoring tool-response for castId ${castId} (current: ${currentCastId})`);
    return;
  }
  
  // Only react to updates after the last Run click
  if (Date.now() - lastRunTimestamp > 60000) {
    return;
  }

  console.log('[SpellPage] tool-response received', { toolId, castId });

  // Update progress
  if (outputEl) {
    outputEl.style.color = '';
    outputEl.textContent = `⏳ Executing spell...\nCompleted step: ${toolId}`;
  }
  
  // If output is provided, render it (but this might be intermediate)
  if (output) {
    renderOutput({ text: output }, castId, true); // true = intermediate
  }
}

const slug = window.location.pathname.split('/').pop();
const metadataEl = document.getElementById('spell-metadata');
const formEl = document.getElementById('input-form');
const quoteEl = document.getElementById('quote-section');
const walletSection = document.getElementById('wallet-section');
const connectWalletBtn = document.getElementById('connect-wallet-btn');
const walletAddressEl = document.getElementById('wallet-address');
const accountInfoEl = document.getElementById('account-info');
const runBtn = document.getElementById('run-btn');
const outputEl = document.getElementById('output-section');

// User account state
let userAccount = null;
let userPointsBalance = 0;

// Listen for spell execution events from buyPointsModal
window.addEventListener('spellExecuted', (event) => {
  const { castId, slug: executedSlug } = event.detail;
  if (executedSlug === slug) {
    // Track castId for WebSocket updates
    if (castId) {
      currentCastId = castId;
      lastRunTimestamp = Date.now();
      console.log('[SpellPage] Tracking spell execution from buyPointsModal:', currentCastId);
      
      // Try to connect WebSocket first (user should be authenticated after purchase)
      connectWebSocketAfterAuth();
      
      // Start polling as fallback (will stop automatically when WebSocket connects)
      setTimeout(() => {
        if (!wsConnected) {
          console.log('[SpellPage] WebSocket not connected, using polling fallback');
          startPollingForResults(castId);
        } else {
          console.log('[SpellPage] WebSocket connected, using real-time updates');
        }
      }, 500);
    }
    
    outputEl.style.color = '';
    outputEl.textContent = '✅ Spell execution started successfully!\n';
    if (castId) {
      outputEl.textContent += `Cast ID: ${castId}\n`;
    }
    outputEl.textContent += '⏳ Waiting for results...';
  }
});

// Polling fallback for non-authenticated users or when WebSocket is unavailable
function startPollingForResults(castId) {
  // Stop any existing polling
  stopPolling();
  
  console.log('[SpellPage] Starting polling for cast results:', castId);
  let pollCount = 0;
  let pollDelay = 2000; // Start with 2 seconds
  const maxDelay = 10000; // Max 10 seconds between polls
  const maxPolls = 180; // ~10 minutes max (with exponential backoff)
  
  const poll = async () => {
    pollCount++;
    
    if (pollCount > maxPolls) {
      stopPolling();
      outputEl.style.color = '#ff9800';
      outputEl.textContent = '⏱️ Spell execution is taking longer than expected. Please check back later or refresh the page.';
      return;
    }
    
    try {
      // Poll the cast status endpoint
      const res = await fetch(`/api/v1/spells/casts/${castId}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!res.ok) {
        // If 404, cast might not be ready yet - continue polling for a bit
        if (res.status === 404) {
          if (pollCount < 5) {
            // Early polls might return 404, use shorter delay
            setTimeout(poll, 1000);
            return;
          }
          // After 5 polls, if still 404, the cast might not exist or be accessible
          console.warn('[SpellPage] Cast not found (404) after multiple attempts, stopping polling');
          stopPolling();
          outputEl.style.color = '#ff9800';
          outputEl.textContent = '⚠️ Unable to fetch cast status. The spell may have completed. Check your account for results.';
          return;
        }
        throw new Error(`Failed to fetch cast status: ${res.status}`);
      }
      
      const castData = await res.json();
      
      // Check if spell is completed
      if (castData.status === 'completed' || castData.status === 'success') {
        stopPolling();
        
        // Fetch ALL generation outputs (cast uses stepGenerationIds, not generationIds)
        const generationIds = castData.stepGenerationIds || castData.generationIds || [];
        
        if (generationIds.length > 0) {
          try {
            // Fetch all generation outputs at once using POST /status endpoint
            // This endpoint accepts both API keys and session keys (JWT/guest tokens)
            const csrfToken = await getCsrfToken();
            const genRes = await fetch('/api/v1/generations/status', {
              method: 'POST',
              credentials: 'include',
              headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-csrf-token': csrfToken || ''
              },
              body: JSON.stringify({ generationIds })
            });
            
            if (genRes.ok) {
              const genData = await genRes.json();
              const generations = genData.generations || [];
              
              if (generations.length > 0) {
                // Render all outputs, showing each step
                renderSpellOutputs(generations, castId);
                return;
              }
            } else {
              console.warn(`[SpellPage] Failed to fetch generation outputs: ${genRes.status}`);
              // Try fetching them individually as fallback
              try {
                const generationPromises = generationIds.map(id => 
                  fetch(`/api/v1/generations/status/${id}`, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                  }).then(res => res.ok ? res.json() : null).catch(() => null)
                );
                const generationResults = await Promise.all(generationPromises);
                const validGenerations = generationResults.filter(gen => gen && (gen.responsePayload || gen.outputs));
                
                if (validGenerations.length > 0) {
                  renderSpellOutputs(validGenerations, castId);
                  return;
                }
              } catch (fallbackErr) {
                console.warn('[SpellPage] Fallback fetch also failed:', fallbackErr);
              }
            }
          } catch (err) {
            console.warn('[SpellPage] Failed to fetch generation outputs:', err);
          }
        }
        
        // Fallback: show completion message
        outputEl.style.color = '';
        outputEl.textContent = '✅ Spell execution completed successfully!';
      } else if (castData.status === 'failed' || castData.status === 'error') {
        stopPolling();
        outputEl.style.color = '#dc3545';
        outputEl.textContent = `❌ Spell execution failed: ${castData.error || 'Unknown error'}`;
      } else {
        // Still in progress - update status occasionally
        if (pollCount % 3 === 0) { // Update UI every 3 polls
          outputEl.style.color = '';
          outputEl.textContent = `⏳ Executing spell... (checking status)`;
        }
        
        // Exponential backoff: increase delay up to maxDelay
        pollDelay = Math.min(pollDelay * 1.2, maxDelay);
        pollingInterval = setTimeout(poll, pollDelay);
      }
    } catch (error) {
      // Network errors - continue polling but log occasionally
      if (pollCount % 10 === 0) {
        console.warn('[SpellPage] Polling error:', error);
      }
      // Continue polling with exponential backoff
      pollDelay = Math.min(pollDelay * 1.2, maxDelay);
      pollingInterval = setTimeout(poll, pollDelay);
    }
  };
  
  // Start first poll immediately, then use exponential backoff
  poll();
}

function stopPolling() {
  if (pollingInterval) {
    // Handle both setInterval and setTimeout
    if (typeof pollingInterval === 'number') {
      clearTimeout(pollingInterval);
    } else {
      clearInterval(pollingInterval);
    }
    pollingInterval = null;
    console.log('[SpellPage] Stopped polling for results');
  }
}

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

// Fetch user account info (if authenticated)
async function fetchUserAccount(){
  try {
    const res = await fetch('/api/v1/user/dashboard', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if(res.ok){
      userAccount = await res.json();
      userPointsBalance = parseFloat(userAccount.points || 0);
      renderAccountInfo();
      
      // User is authenticated - try to connect WebSocket if not already connected
      // Skip auth check since we just verified authentication via dashboard endpoint
      if (!wsConnected) {
        console.log('[SpellPage] User authenticated via dashboard, attempting WebSocket connection...');
        connectWebSocketAfterAuth(true);
      }
      
      return true;
    }
  } catch(err){
    console.warn('Failed to fetch user account:', err);
  }
  return false;
}

function renderAccountInfo(){
  if(!accountInfoEl) return;
  
  if(userAccount){
    const wallet = userAccount.wallet ? `${userAccount.wallet.slice(0,6)}...${userAccount.wallet.slice(-4)}` : 'Not connected';
    accountInfoEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #263238; border-radius: 6px; margin-bottom: 10px;">
        <div>
          <div style="font-size: 12px; color: #90caf9;">Wallet</div>
          <div style="font-weight: bold;">${wallet}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 12px; color: #90caf9;">Points Balance</div>
          <div style="font-weight: bold; color: #4caf50;">💎 ${userPointsBalance.toFixed(2)}</div>
        </div>
      </div>
    `;
    accountInfoEl.style.display = 'block';
  } else {
    accountInfoEl.style.display = 'none';
  }
}

async function fetchMetadata(){
  const res = await fetch(`/api/v1/spells/${slug}`);
  if(!res.ok){metadataEl.textContent='Spell not found.';return;}
  spellMeta = await res.json();
  renderMetadata();
  renderForm();
  // Fetch user account info (if authenticated)
  await fetchUserAccount();
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
  if(!res.ok){
    quoteEl.style.display='block';
    quoteEl.innerHTML=`<h3>Cost Estimation</h3><p style="color: #dc3545;">Unable to estimate cost. This spell may not have enough execution history.</p>`;
    return;
  }
  
  currentQuote = await res.json();
  const baseCost = currentQuote.totalCostPts || 0;
  
  // Handle zero cost case - allow execution but skip payment
  if(baseCost <= 0){
    quoteEl.style.display='block';
    quoteEl.innerHTML=`<h3>Cost Estimation</h3><p>⚠️ No cost estimation available (0 points)</p><p><small>This spell may not have enough execution history. You can still try running it - no payment required.</small></p>`;
    // Show run button for zero-cost spells (they'll skip payment)
    runBtn.style.display='inline-block';
    if(walletSection) walletSection.style.display = 'none';
    return;
  }
  
  const bufferCost = Math.ceil(baseCost * 1.2); // 20% buffer
  quoteEl.style.display='block';
  
  // Show balance comparison if user is authenticated
  let balanceInfo = '';
  if(userAccount){
    const hasEnough = userPointsBalance >= baseCost;
    const balanceColor = hasEnough ? '#4caf50' : '#ff9800';
    balanceInfo = `<p style="margin-top: 8px; padding: 8px; background: #263238; border-radius: 4px;">
      <span style="color: #90caf9;">Your Balance:</span> <span style="color: ${balanceColor}; font-weight: bold;">💎 ${userPointsBalance.toFixed(2)} pts</span>
      ${hasEnough ? ' ✅' : ' ⚠️ Need more'}
    </p>`;
  }
  
  // Build breakdown HTML if available
  let breakdownHtml = '';
  if (currentQuote.breakdown && Array.isArray(currentQuote.breakdown) && currentQuote.breakdown.length > 0) {
    breakdownHtml = '<div style="margin-top: 12px; padding: 8px; background: #1e3a5f; border-radius: 4px;"><p style="margin: 0 0 8px 0; color: #90caf9; font-size: 0.9em; font-weight: bold;">Cost Breakdown:</p><ul style="margin: 0; padding-left: 20px; color: #b0bec5; font-size: 0.85em;">';
    currentQuote.breakdown.forEach(item => {
      const toolName = item.toolId || 'Unknown';
      const cost = (item.avgCostPts || 0).toFixed(1);
      breakdownHtml += `<li style="margin: 4px 0;"><span style="color: #90caf9;">${toolName}</span>: ${cost} pts</li>`;
    });
    breakdownHtml += '</ul></div>';
  }
  
  quoteEl.innerHTML=`<h3>Estimated Cost</h3><p>Base: ${baseCost.toFixed(0)} pts</p><p>Payment (with 20% buffer): ${bufferCost.toFixed(0)} pts</p><p><small>Excess points remain in your account for future use</small></p>${breakdownHtml}${balanceInfo}`;
  
  // Show run button if user has enough points, otherwise show wallet connection
  if(userAccount && userPointsBalance >= baseCost){
    // User has enough points - show run button
    runBtn.style.display='inline-block';
    if(walletSection) walletSection.style.display = 'none';
  } else if(window.walletConnect && window.walletConnect.isWalletConnected()){
    // Wallet connected but may not have enough points - show run button (will check balance on click)
  runBtn.style.display='inline-block';
    if(walletSection) walletSection.style.display = 'none';
  } else {
    // No wallet connected - show wallet section to prompt connection
    showWalletSection();
    // Run button will appear after wallet connection
  }
}

// Render all spell step outputs
function renderSpellOutputs(generations, castId = null) {
  // Verify this is for the current execution
  if (castId && currentCastId && castId !== currentCastId) {
    console.log(`[SpellPage] Ignoring renderSpellOutputs for castId ${castId} (current: ${currentCastId})`);
    return;
  }
  
  console.log(`[SpellPage] Rendering spell outputs for castId: ${castId}, ${generations?.length || 0} generations`);
  
  // Clear output element completely before rendering
  outputEl.textContent = '';
  outputEl.innerHTML = '';
  outputEl.style.display = 'block';
  outputEl.style.color = '';
  
  if (!generations || generations.length === 0) {
    outputEl.textContent = 'Spell execution completed, but no outputs found.';
    return;
  }
  
  // Build HTML showing all steps and final result
  let html = '<div style="margin-top: 16px;"><h3>✅ Spell Execution Complete</h3>';
  
  // Show each step
  generations.forEach((gen, index) => {
    const toolId = gen.toolId || gen.toolDisplayName || `Step ${index + 1}`;
    const status = gen.status || 'completed';
    const stepNum = index + 1;
    
    html += `<div style="margin: 16px 0; padding: 12px; background: #263238; border-radius: 8px; border-left: 3px solid #4caf50;">`;
    html += `<h4 style="margin: 0 0 8px 0; color: #90caf9;">Step ${stepNum}: ${toolId}</h4>`;
    html += `<p style="margin: 0; color: #b0bec5; font-size: 0.9em;">Status: ${status}</p>`;
    
    // Render output for this step if available (check both responsePayload and outputs)
    const stepOutputData = gen.responsePayload || gen.outputs;
    if (stepOutputData) {
      html += '<div style="margin-top: 12px;">';
      const stepOutput = normalizeOutput(stepOutputData);
      if (stepOutput.type === 'text' && stepOutput.text) {
        // Escape HTML and preserve line breaks
        const escapedText = String(stepOutput.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        html += `<div style="color: #e0e0e0; white-space: pre-wrap;">${escapedText}</div>`;
      } else if (stepOutput.type === 'image' && stepOutput.url) {
        html += `<img src="${stepOutput.url}" style="max-width: 100%; border-radius: 4px; margin-top: 8px;" alt="Step ${stepNum} output" />`;
      } else if (stepOutput.type === 'video' && stepOutput.url) {
        html += `<video controls style="max-width: 100%; border-radius: 4px; margin-top: 8px;"><source src="${stepOutput.url}" type="video/mp4"></video>`;
      }
      html += '</div>';
    }
    
    html += '</div>';
  });
  
  // Highlight final result
  const finalGen = generations[generations.length - 1];
  const finalOutputData = finalGen && (finalGen.responsePayload || finalGen.outputs);
  if (finalOutputData) {
    html += '<div style="margin-top: 24px; padding: 16px; background: #1e3a5f; border-radius: 8px; border: 2px solid #4caf50;">';
    html += '<h3 style="margin: 0 0 12px 0; color: #4caf50;">Final Result</h3>';
    const finalOutput = normalizeOutput(finalOutputData);
    if (finalOutput.type === 'text' && finalOutput.text) {
      const escapedText = String(finalOutput.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      html += `<div style="color: #e0e0e0; white-space: pre-wrap; font-size: 1.1em;">${escapedText}</div>`;
    } else if (finalOutput.type === 'image' && finalOutput.url) {
      html += `<img src="${finalOutput.url}" style="max-width: 100%; border-radius: 4px;" alt="Final result" />`;
    } else if (finalOutput.type === 'video' && finalOutput.url) {
      html += `<video controls style="max-width: 100%; border-radius: 4px;"><source src="${finalOutput.url}" type="video/mp4"></video>`;
    }
    html += '</div>';
  }
  
  html += '</div>';
  outputEl.innerHTML = html;
}

// Helper to normalize output format
function normalizeOutput(output) {
  if (!output) return { type: 'text', text: 'No output' };
  
  // Handle array format
  if (Array.isArray(output)) {
    if (output[0]?.type === 'text' && output[0]?.data?.text) {
      const text = Array.isArray(output[0].data.text) ? output[0].data.text.join('\n\n') : output[0].data.text;
      return { type: 'text', text };
    }
    if (output[0]?.data?.images?.[0]?.url) {
      return { type: 'image', url: output[0].data.images[0].url };
    }
  }
  
  // Handle object format
  if (output.result) {
    if (typeof output.result === 'string') {
      return { type: 'text', text: output.result };
    }
  }
  
  if (output.text || (output.data && output.data.text)) {
    const txt = output.text || output.data.text;
    return { type: 'text', text: Array.isArray(txt) ? txt.join('\n\n') : txt };
  }
  
  if (output.artifactUrls && output.artifactUrls.length) {
    return { type: 'image', url: output.artifactUrls[0] };
  }
  
  if (output.images && output.images.length) {
    const first = output.images[0];
    return { type: 'image', url: typeof first === 'string' ? first : first.url };
  }
  
  if (output.imageUrl || output.image) {
    return { type: 'image', url: output.imageUrl || output.image };
  }
  
  if (output.video || output.videoUrl) {
    return { type: 'video', url: output.video || output.videoUrl };
  }
  
  // Fallback: stringify as JSON
  return { type: 'text', text: JSON.stringify(output, null, 2) };
}

function renderOutput(outputs, castId = null, isIntermediate = false) {
  // Verify this is for the current execution (unless it's intermediate)
  if (!isIntermediate && castId && currentCastId && castId !== currentCastId) {
    console.log(`[SpellPage] Ignoring renderOutput for castId ${castId} (current: ${currentCastId})`);
    return;
  }
  
  console.log(`[SpellPage] Rendering output for castId: ${castId}, isIntermediate: ${isIntermediate}`);
  
  // Clear output element completely before rendering (unless intermediate)
  if (!isIntermediate) {
    outputEl.textContent = '';
    outputEl.innerHTML = '';
  }
  
  outputEl.style.display = 'block';
  outputEl.style.color = '';
  
  if (!outputs) {
     outputEl.textContent = 'Spell execution completed.';
    return;
  }

  // Handle spell multi-step output (from SpellWindow pattern)
  if (outputs.steps && Array.isArray(outputs.steps)) {
    // Multi-step spell output - show final result or step selector
    const finalOutput = outputs.final || outputs.steps[outputs.steps.length - 1]?.output || outputs.steps[outputs.steps.length - 1]?.outputs;
    if (finalOutput) {
      renderOutputContent(finalOutput);
    } else {
      // Show step selector UI (simplified version)
      outputEl.innerHTML = '<h3>Spell Execution Complete</h3><p>All steps completed successfully.</p>';
    }
    return;
  }

  // Handle single output
  renderOutputContent(outputs, isIntermediate);
}

function renderOutputContent(output, isIntermediate = false) {
  // Normalize output format (similar to SpellWindow resultContent.js)
  let outputData = output;
  
  // Auto-normalize common wrappers
  if (!outputData.type) {
    if (Array.isArray(outputData.artifactUrls) && outputData.artifactUrls.length) {
      outputData = { type: 'image', url: outputData.artifactUrls[0] };
    } else if (Array.isArray(outputData.images) && outputData.images.length) {
      // Handle both string URLs and object URLs
      const first = outputData.images[0];
      const imageUrl = typeof first === 'string' ? first : (first.url || first);
      outputData = { type: 'image', url: imageUrl };
      console.log('[SpellPage] Normalized image output in renderOutputContent:', imageUrl);
    } else if (outputData.imageUrl) {
      outputData = { type: 'image', url: outputData.imageUrl };
    } else if (outputData.image) {
      outputData = { type: 'image', url: outputData.image };
    } else if (outputData.text || outputData.response || (outputData.data && (outputData.data.text || outputData.data.response))) {
      const txt = outputData.text || outputData.response || outputData.data?.text || outputData.data?.response;
      outputData = { type: 'text', text: txt };
    } else if (outputData.video || outputData.videoUrl) {
      outputData = { type: 'video', url: outputData.video || outputData.videoUrl };
    } else if (Array.isArray(outputData) && outputData[0]?.data?.images?.[0]?.url) {
      outputData = { type: 'image', url: outputData[0].data.images[0].url };
    } else if (Array.isArray(outputData) && outputData[0]?.data?.text) {
      const t = outputData[0].data.text;
      outputData = { type: 'text', text: Array.isArray(t) ? t.join('\n\n') : t };
    } else if (Array.isArray(outputData) && typeof outputData[0] === 'string') {
      outputData = { type: 'text', text: outputData.join('\n\n') };
    } else if (typeof outputData === 'string') {
      outputData = { type: 'text', text: outputData };
    }
  }

  // Render based on type
  if (outputData.type === 'image' && outputData.url) {
    outputEl.innerHTML = `
      <div style="margin-top: 16px;">
        <h3>${isIntermediate ? 'Step Result' : 'Spell Result'}</h3>
        <img src="${outputData.url}" style="max-width: 100%; border-radius: 8px; margin-top: 12px;" alt="Spell output" />
      </div>
    `;
  } else if (outputData.type === 'video' && outputData.url) {
    outputEl.innerHTML = `
      <div style="margin-top: 16px;">
        <h3>${isIntermediate ? 'Step Result' : 'Spell Result'}</h3>
        <video controls style="max-width: 100%; border-radius: 8px; margin-top: 12px;">
          <source src="${outputData.url}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
    `;
  } else if (outputData.type === 'text' && outputData.text) {
    const textContent = typeof outputData.text === 'string' ? outputData.text : JSON.stringify(outputData.text, null, 2);
    outputEl.innerHTML = `
      <div style="margin-top: 16px;">
        <h3>${isIntermediate ? 'Step Result' : 'Spell Result'}</h3>
        <pre style="background: #263238; padding: 16px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; margin-top: 12px;">${escapeHtml(textContent)}</pre>
      </div>
    `;
  } else {
    // Fallback: show JSON
    outputEl.innerHTML = `
      <div style="margin-top: 16px;">
        <h3>${isIntermediate ? 'Step Result' : 'Spell Result'}</h3>
        <pre style="background: #263238; padding: 16px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; margin-top: 12px;">${escapeHtml(JSON.stringify(outputData, null, 2))}</pre>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Listen for wallet connection events
window.addEventListener('walletConnected', async (e) => {
  const address = e.detail?.address || window.walletConnect?.getWalletAddress();
  if (address) {
    showWalletStatus(address);
    // Hide wallet section
    if (walletSection) {
      walletSection.style.display = 'none';
    }
    // Refresh account info (wallet might be linked to account)
    await fetchUserAccount();
    // Re-render quote to update balance info
    if(currentQuote){
      fetchQuote();
    }
    // Show run button if quote is ready
    if (currentQuote && runBtn) {
      runBtn.style.display = 'inline-block';
    }
  }
});

runBtn.addEventListener('click', async ()=>{
  if(!currentQuote) {
    showError('Please wait for cost estimate to load.');
    return;
  }
  
  // CRITICAL: Reset state for new execution
  // Stop any existing polling from previous execution
  stopPolling();
  
  // Clear previous cast ID and reset state
  const previousCastId = currentCastId;
  currentCastId = null; // Reset before new execution
  
  // Clear output element completely (both textContent and innerHTML)
  outputEl.textContent = '';
  outputEl.innerHTML = '';
  outputEl.style.display = 'block';
  outputEl.style.color = '';
  
  // Update timestamp for new execution
  lastRunTimestamp = Date.now();
  
  runBtn.disabled = true;
  
  console.log(`[SpellPage] Starting new spell execution. Previous castId: ${previousCastId || 'none'}`);
  
  // IMPORTANT: Fetch user account balance FIRST before making any decisions
  // This ensures we have the latest balance information
  await fetchUserAccount();
  
  let spellPaymentId = null;
  let txHash = null;
  
  try{
    // 1. Check if spell has cost - if zero, skip wallet/payment entirely
    const hasCost = currentQuote.totalCostPts && currentQuote.totalCostPts > 0;
    
    // Helper function to execute spell directly (when user has points)
    async function executeSpellDirectly(){
      runBtn.textContent='Running spell...';
    const csrfToken = await getCsrfToken();
      try {
    const execRes = await fetch('/api/v1/spells/cast',{
        method:'POST',
          headers:{
            'Content-Type':'application/json',
            'x-csrf-token': csrfToken || ''
          },
          credentials:'include',
          body:JSON.stringify({ 
            slug, 
            context:{ 
              parameterOverrides: currentInputs,
              quote: currentQuote,
              chargeUpfront: true
            }
          })
        });
        
        if(!execRes.ok){
          const errorData = await execRes.json().catch(()=>({}));
          const errorMsg = errorData.error?.message || 'Spell execution failed';
          
          if(errorMsg.includes('Insufficient points') || errorMsg.includes('insufficient points')){
            // Balance changed or quote was wrong - redirect to buyPointsModal
            if(window.openBuyPointsModal){
              outputEl.style.color = '';
              outputEl.textContent = '⚠️ Insufficient points. Opening purchase modal...';
              setTimeout(() => {
                window.openBuyPointsModal({
                  slug: slug,
                  inputs: currentInputs,
                  quote: currentQuote
                });
              }, 500);
              return;
            }
          }
          handleError('SPELL_EXECUTION', new Error(errorMsg));
          return;
        }
        
        const execResult = await execRes.json();
        
        // Track castId for WebSocket updates
        if (execResult.castId) {
          currentCastId = execResult.castId;
          console.log('[SpellPage] Tracking spell execution:', currentCastId);
          
          // Try to connect WebSocket first (if authenticated)
          connectWebSocketAfterAuth();
          
          // Start polling as fallback (will stop automatically when WebSocket connects)
          // Use a small delay to give WebSocket time to connect
          setTimeout(() => {
            if (!wsConnected) {
              console.log('[SpellPage] WebSocket not connected, using polling fallback');
              startPollingForResults(execResult.castId);
            } else {
              console.log('[SpellPage] WebSocket connected, using real-time updates');
            }
          }, 500);
        }
        
        // Display success
        outputEl.style.color = '';
        outputEl.textContent='✅ Spell execution started successfully!\n';
        if(execResult.castId){
          outputEl.textContent += `Cast ID: ${execResult.castId}\n`;
        }
        outputEl.textContent += '⏳ Waiting for results...';
        
        // Refresh account balance
        await fetchUserAccount();
      } catch(err){
        handleError('SPELL_EXECUTION_NETWORK', err);
      }
    }
    
    // Only require wallet for spells with cost
    if(hasCost){
      // Check if user has sufficient points balance (if authenticated)
      // Note: fetchUserAccount() was called at the start of this handler
      if(userAccount && typeof userPointsBalance === 'number' && userPointsBalance >= currentQuote.totalCostPts){
        // User has enough points, proceed directly to execution
        outputEl.textContent = 'Executing spell with existing points balance...';
        await executeSpellDirectly();
        return;
      }
      
      // If userAccount exists but balance is insufficient, log for debugging
      if(userAccount && typeof userPointsBalance === 'number'){
        console.log(`[SpellPage] User has ${userPointsBalance} points, need ${currentQuote.totalCostPts} points`);
      }
      
      // User doesn't have enough points (or not authenticated), need payment
      // Check/connect wallet if not connected
      if(!window.walletConnect || !window.walletConnect.isWalletConnected()){
        // Show modal to connect wallet
        window.walletConnect.showWalletModal();
        runBtn.disabled = false;
        runBtn.textContent = 'Run Spell';
        outputEl.textContent = 'Please connect your wallet to continue.';
        return; // Exit early, user needs to connect wallet first
      }
      
      // Verify wallet is still connected
      const walletAddress = window.walletConnect.getWalletAddress();
      if(!walletAddress){
        handleError('WALLET_DISCONNECTED', new Error('Wallet disconnected. Please reconnect.'));
        return;
      }
      
      // Check balance again after wallet connection (in case wallet is linked to account)
      await fetchUserAccount();
      if(userAccount && userPointsBalance >= currentQuote.totalCostPts){
        // User has enough points now, proceed directly to execution
        outputEl.textContent = 'Executing spell with existing points balance...';
        await executeSpellDirectly();
        return;
      }
      
      // Still insufficient points - redirect to buyPointsModal for payment
      if(window.openBuyPointsModal){
        outputEl.style.color = '';
        outputEl.textContent = '⚠️ Insufficient points. Opening purchase modal...';
        setTimeout(() => {
          window.openBuyPointsModal({
            slug: slug,
            inputs: currentInputs,
            quote: currentQuote
          });
        }, 500);
        runBtn.disabled = false;
        runBtn.textContent = 'Run Spell';
        return;
      } else {
        // Fallback: show error if modal not available
        handleError('INSUFFICIENT_POINTS', new Error('Insufficient points. Please purchase more points to execute this spell.'));
        return;
      }
    }
    
    // 2. Handle zero-cost spells (skip payment flow)
    if(!hasCost){
      // Zero-cost spell - skip payment and go straight to execution
      runBtn.textContent='Running spell...';
      outputEl.textContent='Executing spell (no payment required)...';
      
      const csrfToken = await getCsrfToken();
      let execRes;
      try {
        execRes = await fetch('/api/v1/spells/cast',{
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              'x-csrf-token': csrfToken || ''
            },
        credentials:'include',
            body:JSON.stringify({ 
              slug, 
              context:{ 
                parameterOverrides: currentInputs,
                chargeUpfront: false // Don't charge for zero-cost spells
              }
            })
        });
      } catch(err){
        if(err.message.includes('network') || err.message.includes('fetch')){
          handleError('NETWORK_ERROR', err, 'Failed to execute spell. Please check your connection and try again.');
        } else {
          handleError('SPELL_EXECUTION_NETWORK', err);
        }
        return;
      }
      
      if(!execRes.ok){
        const errorData = await execRes.json().catch(()=>({}));
        const errorMsg = errorData.error?.message || 'Spell execution failed';
        handleError('SPELL_EXECUTION', new Error(errorMsg));
        return;
      }
      
      const execResult = await execRes.json();
      
      // Track castId for WebSocket updates
      if (execResult.castId) {
        currentCastId = execResult.castId;
        console.log('[SpellPage] Tracking spell execution:', currentCastId);
        
        // Try to connect WebSocket first (if authenticated)
        connectWebSocketAfterAuth();
        
        // Start polling as fallback (will stop automatically when WebSocket connects)
        setTimeout(() => {
          if (!wsConnected) {
            console.log('[SpellPage] WebSocket not connected, using polling fallback');
            startPollingForResults(execResult.castId);
          } else {
            console.log('[SpellPage] WebSocket connected, using real-time updates');
          }
        }, 500);
      }
      
      // Display success
      outputEl.style.color = '';
      outputEl.textContent='✅ Spell execution started successfully!\n';
      if(execResult.castId){
        outputEl.textContent += `Cast ID: ${execResult.castId}\n`;
      }
      outputEl.textContent += '⏳ Waiting for results...';
      
      return; // Exit early for zero-cost spells
    }
    
    // 3. If we reach here, user needs to purchase points - redirect to buyPointsModal
    // (This should not happen if balance check worked correctly, but serves as fallback)
    if(window.openBuyPointsModal){
      outputEl.style.color = '';
      outputEl.textContent = '⚠️ Insufficient points. Opening purchase modal...';
      setTimeout(() => {
        window.openBuyPointsModal({
          slug: slug,
          inputs: currentInputs,
          quote: currentQuote
        });
      }, 500);
      runBtn.disabled = false;
      runBtn.textContent = 'Run Spell';
      return;
    } else {
      handleError('INSUFFICIENT_POINTS', new Error('Insufficient points. Please purchase more points to execute this spell.'));
      return;
    }
    
  }catch(err){
    handleError('UNEXPECTED', err);
  }finally{
    runBtn.disabled=false;
    runBtn.textContent='Run Spell';
  }
});

async function waitForPaymentConfirmation(spellPaymentId, txHash){
  const maxAttempts = 300; // 5 minutes at 1 second intervals
  let lastError = null;
  
  for(let i=0; i<maxAttempts; i++){
    try {
      const res = await fetch(`/api/v1/payments/status/${spellPaymentId}`);
      
      if(!res.ok){
        // Non-fatal - continue polling
        if(i % 30 === 0){ // Log every 30 seconds
          console.warn(`Payment status check failed (attempt ${i}):`, res.status);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      const data = await res.json();
      
      if(data.status === 'confirmed' && data.guestToken){
        outputEl.textContent=`✅ Payment confirmed!`;
        
        // Set guest token and connect WebSocket
        setGuestTokenAndConnect(data.guestToken);
        
        return data.guestToken;
      }
      
      if(data.status === 'failed' || data.status === 'error'){
        throw new Error(data.message || 'Payment failed on blockchain');
      }
      
      // Show progress every 10 seconds
      if(i % 10 === 0){
        const minutes = Math.floor(i / 60);
        const seconds = i % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        outputEl.textContent=`Waiting for blockchain confirmation... (${timeStr})\nTransaction: ${txHash.substring(0,20)}...\n\nYou can check status at: https://etherscan.io/tx/${txHash}`;
      }
      
      lastError = null; // Reset error on successful check
    } catch(err){
      lastError = err;
      // If it's a fatal error (not a network issue), throw immediately
      if(err.message.includes('failed') || err.message.includes('error')){
        throw err;
      }
      // For network errors, continue polling but log occasionally
      if(i % 30 === 0){
        console.warn(`Payment status check error (attempt ${i}):`, err.message);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // If we have a last error, include it in the timeout message
  const errorMsg = lastError 
    ? `Payment confirmation timeout. Last error: ${lastError.message}. `
    : 'Payment confirmation timeout. ';
  
  throw new Error(errorMsg + `Please check your transaction on the blockchain: https://etherscan.io/tx/${txHash}`);
}

function trackExecutionForRefund(castId, spellPaymentId){
  // Store execution tracking (for future reference)
  try{
    localStorage.setItem(`spell_exec_${castId}`, JSON.stringify({
      spellPaymentId,
      timestamp: Date.now()
    }));
  }catch(e){
    console.warn('Failed to store execution tracking:', e);
  }
}

function handleError(errorType, error, userMessage = null){
  outputEl.style.display = 'block';
  outputEl.style.color = '#dc3545';
  
  const errorMessages = {
    'WALLET_CONNECTION': 'Failed to connect wallet. Please make sure MetaMask or another Web3 wallet is installed and unlocked.',
    'WALLET_DISCONNECTED': 'Wallet disconnected. Please reconnect your wallet and try again.',
    'NETWORK_ERROR': 'Network error. Please check your internet connection and try again.',
    'TRANSACTION_GENERATION': 'Failed to prepare payment transaction. Please try again.',
    'TRANSACTION_REJECTED': 'Transaction was rejected in your wallet. Please try again when ready.',
    'TRANSACTION_SEND': 'Failed to send transaction. Please check your wallet and try again.',
    'INSUFFICIENT_FUNDS': 'Insufficient funds in wallet. Please add more ETH and try again.',
    'PAYMENT_TIMEOUT': 'Payment confirmation is taking longer than expected. Please check the transaction on Etherscan.',
    'PAYMENT_FAILED': 'Payment transaction failed on the blockchain. Please try again.',
    'PAYMENT_CONFIRMATION': 'Failed to confirm payment. Please check the transaction status.',
    'SPELL_EXECUTION': 'Spell execution failed. Payment was successful - please contact support.',
    'SPELL_EXECUTION_NETWORK': 'Network error during spell execution. Payment was successful.',
    'INSUFFICIENT_POINTS': 'Payment successful but insufficient points. Please contact support.',
    'LIBRARY_LOAD': 'Failed to load required libraries. Please refresh the page.',
    'INVALID_QUOTE': 'Spell cost estimation is zero or invalid. This spell may not have enough execution history.',
    'UNEXPECTED': 'An unexpected error occurred. Please try again or contact support.'
  };
  
  const message = userMessage || errorMessages[errorType] || error.message || 'An error occurred. Please try again.';
  
  outputEl.textContent = `❌ Error: ${message}`;
  
  if(error && error.stack){
    console.error(`[${errorType}]`, error);
  } else {
    console.error(`[${errorType}]`, message, error);
  }
  
  // Show transaction hash if available for user to check
  if(errorType.includes('PAYMENT') || errorType.includes('SPELL_EXECUTION')){
    const txHashMatch = message.match(/0x[a-fA-F0-9]{64}/);
    if(txHashMatch){
      outputEl.textContent += `\n\nTransaction: ${txHashMatch[0]}\nCheck status: https://etherscan.io/tx/${txHashMatch[0]}`;
    }
  }
}

function showError(message){
  outputEl.style.display = 'block';
  outputEl.style.color = '#dc3545';
  outputEl.textContent = `⚠️ ${message}`;
}

function showWalletStatus(address){
  // Update UI to show wallet is connected
  if(walletSection && walletAddressEl){
    walletAddressEl.textContent = `Connected: ${address.substring(0,6)}...${address.substring(address.length-4)}`;
    walletAddressEl.style.display = 'block';
    if(connectWalletBtn){
      connectWalletBtn.textContent = 'Connected';
      connectWalletBtn.disabled = true;
    }
  }
  
  // Hide wallet section and show run button if quote is ready
  if(walletSection){
    walletSection.style.display = 'none';
  }
  if(currentQuote && runBtn){
    runBtn.style.display = 'inline-block';
  }
}

function showWalletSection(){
  // Only show wallet section if not connected
  if(currentQuote && walletSection && !window.walletConnect?.isWalletConnected()){
    walletSection.style.display = 'block';
  }
}

// Wallet connection button handler - opens modal
if(connectWalletBtn){
  connectWalletBtn.addEventListener('click', () => {
    window.walletConnect.showWalletModal();
  });
}

// Initialize wallet connection check after page loads
async function initializeWalletCheck() {
  // Wait for wallet-connect.js to be available
  if (!window.walletConnect) {
    setTimeout(initializeWalletCheck, 100);
    return;
  }
  
  const address = await window.walletConnect.checkExistingConnection();
  if (address) {
    showWalletStatus(address);
  }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeWalletCheck();
    initializeWebSocket();
  });
} else {
  initializeWalletCheck();
  initializeWebSocket();
}

fetchMetadata(); 