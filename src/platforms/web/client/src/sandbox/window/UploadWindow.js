import BaseWindow from './BaseWindow.js';
import { el, clear } from './domHelpers.js';
import { createAnchorPoint } from '../node/anchors.js';
// helper to read csrf cookie
const getCsrfToken = () => document.cookie.split('; ').find(c=>c.startsWith('csrfToken='))?.split('=')[1]||'';

export default class UploadWindow extends BaseWindow {
  constructor(opts) {
    super({ ...opts, title: 'Upload Media', icon: '📤', classes: ['upload-window'] }, { register: false });
    // Provide minimal tool stub so execution planner expecting tool.displayName doesn't crash
    this.tool = { displayName: 'Upload', metadata: { outputType: 'image' } };
    this.renderBody();
    this._registerWindow();
  }

  serialize(){
    return {
      ...super.serialize(),
      type:'upload',
      tool:this.tool,
      parameterMappings: {},
    };
  }

  renderBody() {
    clear(this.body);

    // Hidden file selector; click on canvas area to trigger
    const fileInput = el('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
    this.body.appendChild(fileInput);

    const canvasWrapper = el('div', { style: { position: 'relative', width: '300px', height: '300px' } });
    this.preview = el('canvas', { width: 300, height: 300, style: { border: '1px solid #999', display: 'none', cursor: 'pointer' } });
    this.overlay = el('canvas', { width: 300, height: 300, style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' } });
    canvasWrapper.append(this.preview, this.overlay);
    this.body.appendChild(canvasWrapper);
    // Status label
    this.statusEl = el('div', { style:{marginTop:'4px',fontSize:'12px',color:'#4caf50',display:'none'}, innerText:'Uploaded ✓'});
    this.body.appendChild(this.statusEl);

    // Toolbar
    const bar = el('div', { style: { marginBottom: '6px' } });
    const rectBtn = el('button', { innerText: 'Rect Mask' });
    const brushBtn = el('button', { innerText: 'Brush' });
    const saveBtn  = el('button', { innerText: 'Save & Upload', className: 'execute-button' });
    bar.append(rectBtn, brushBtn, saveBtn);
    this.body.prepend(bar);
    this.saveBtn = saveBtn;

    this.mode = 'rect';
    rectBtn.onclick = () => { this.mode = 'rect'; };
    brushBtn.onclick = () => { this.mode = 'brush'; };
    saveBtn.onclick  = () => this.uploadEdited();

    // Clicking preview opens file picker when no image yet
    this.preview.addEventListener('click', () => {
      if (!this.file) fileInput.click();
    });

    // --- overlay drawing ---
    const octx = this.overlay.getContext('2d');
    let dragging = false, startX = 0, startY = 0;

    const setPointerEvents = (on) => { this.overlay.style.pointerEvents = on ? 'auto' : 'none'; };

    this.overlay.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = this.overlay.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      if (this.mode === 'brush') {
        octx.fillStyle = '#ffffff';
        octx.beginPath();
        octx.arc(startX, startY, 10, 0, 2*Math.PI);
        octx.fill();
      }
    });

    this.overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = this.overlay.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (this.mode === 'rect') {
        // show rectangle outline while dragging
        octx.clearRect(0,0,300,300);
        octx.strokeStyle = 'rgba(255,255,255,0.8)';
        octx.setLineDash([6]);
        octx.strokeRect(startX, startY, x-startX, y-startY);
      } else if (this.mode === 'brush') {
        octx.fillStyle = '#ffffff';
        octx.beginPath();
        octx.arc(x, y, 10, 0, 2*Math.PI);
        octx.fill();
      }
    });

    const finishRect = (endX,endY) => {
      const x = Math.min(startX,endX); const y = Math.min(startY,endY);
      const w = Math.abs(endX-startX); const h = Math.abs(endY-startY);
      octx.setLineDash([]);
      octx.fillStyle = '#ffffff';
      octx.fillRect(x,y,w,h);
    };

    const stopDrag = (e) => {
      if (!dragging) return;
      dragging=false;
      if (this.mode==='rect'){
        const rect=this.overlay.getBoundingClientRect();
        finishRect(e.clientX-rect.left,e.clientY-rect.top);
      }
    };

    this.overlay.addEventListener('mouseup', stopDrag);
    this.overlay.addEventListener('mouseleave', stopDrag);

    // enable drawing interaction
    setPointerEvents(true);

    fileInput.addEventListener('change', () => {
      const [file] = fileInput.files;
      if (!file) return;
      this.file = file;
      this.drawPreview(file);
    });
  }

  drawPreview(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ctx = this.preview.getContext('2d');
      const { width, height } = this.preview;
      ctx.clearRect(0, 0, width, height);
      // Fit image inside canvas
      const ratio = Math.min(width / img.width, height / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      this.preview.style.display = 'block';
      // Store for full-res merging
      this.imgNaturalWidth = img.width;
      this.imgNaturalHeight = img.height;
      this.scaleRatio = ratio;
      this.imgElement = img;
      this.outputValue = { pendingUpload: true, windowId: this.id, fileName: file.name };

      // Add output anchor once preview is ready (only once)
      if (!this.outputAnchor) {
        // Minimal stub tool metadata for anchor helper
        const fakeTool = { metadata: { outputType: 'image' } };
        this.outputAnchor = createAnchorPoint(fakeTool, this);
        this.body.appendChild(this.outputAnchor);
      }
    };
    img.src = url;
  }

  // Upload workflow will be triggered later when user confirms

  // Allow external caller to supply File directly (e.g., paste handler)
  loadPastedFile(file) {
    this.file = file;
    this.drawPreview(file);
  }

  async uploadEdited(){
    if(!this.file){alert('No image');return;}
    // Merge preview+overlay into new canvas
    const merge = document.createElement('canvas');
    // Preserve original resolution
    const fullW=this.imgNaturalWidth||this.preview.width;
    const fullH=this.imgNaturalHeight||this.preview.height;
    merge.width=fullW; merge.height=fullH;
    const mctx=merge.getContext('2d');
    // Draw original image full size
    mctx.drawImage(this.imgElement,0,0,fullW,fullH);
    // Draw overlay scaled up to full res
    if(this.scaleRatio){
      mctx.save();
      mctx.scale(1/this.scaleRatio,1/this.scaleRatio);
      mctx.drawImage(this.overlay,0,0);
      mctx.restore();
    }
    merge.toBlob(blob=>{
      this.file=new File([blob],this.file.name,{type:'image/png'});
      this.uploadFile();
    },'image/png');
  }

  async uploadFile(){
    if(!this.file)return;
    try{
      const token = window.auth?.ensureCsrfToken ? await window.auth.ensureCsrfToken() : getCsrfToken();
      const res = await fetch('/api/v1/storage/uploads/sign', {
        method:'POST',
        credentials:'include',
        headers:{
          'Content-Type':'application/json',
          'X-CSRF-Token': token
        },
        body:JSON.stringify({fileName:this.file.name,contentType:this.file.type})
      });
      if(!res.ok) throw new Error('sign failed');
      const {signedUrl,permanentUrl}=await res.json();
      const raw = await this.file.arrayBuffer();
      const put=await fetch(signedUrl,{method:'PUT', body: raw});
      if(!put.ok) throw new Error('upload failed');
      console.log('Uploaded',permanentUrl);
      this.permanentUrl=permanentUrl;
      this.output = { type:'image', url: permanentUrl };
      // show status
      this.statusEl.style.display='block';
      this.saveBtn && (this.saveBtn.disabled=true);

      // Update global state so other nodes can resolve this output
      const stateMod = await import('../state.js');
      stateMod.setToolWindowOutput(this.id, this.output);
      stateMod.pushHistory();
      stateMod.persistState();

      // persist state so execution planner sees output
      // (pushHistory/persistState now handled in above update)

      this.outputValue = permanentUrl;
      window.dispatchEvent(new CustomEvent('uploadCompleted',{detail:{windowId:this.id,url:permanentUrl}}));
    }catch(err){console.error(err);}  }

  getOutputValue(){return this.outputValue;}
}
