export default class WorkspaceTourStep {
  constructor() {
    this.id = 'workspace-tour';
    this.stageIndex = 0;
    this.stages = [
      {
        title: 'Workspace Basics',
        body: 'Tap or click anywhere on the canvas to open the Action Menu. From there you can launch tools, spells and more.',
        selector: '.sandbox-canvas, .sandbox-content'
      }
    ];
  }

  render(root, next, skip) {
    // Static version – no waiting for user interaction
    const target=document.querySelector('.sandbox-canvas, .sandbox-content');
    const overlay=document.createElement('div');
    overlay.className='st-onboard-overlay no-bg';
    root.appendChild(overlay);

    if(target) target.classList.add('st-onboarding-highlight');
    const cleanup=()=>{ if(target) target.classList.remove('st-onboarding-highlight'); };

    const rect= target ? target.getBoundingClientRect() : { top:window.innerHeight/2-100, left:window.innerWidth/2-150, width:300, height:0};
    const card=document.createElement('div');
    card.className='st-onboard-card';
    const margin=12;
    let top=rect.top+margin;
    let left=rect.left+margin;
    if(top+200>window.innerHeight) top=window.innerHeight-220;
    if(left+320>window.innerWidth) left=window.innerWidth-340;
    if(top<20) top=20;
    if(left<20) left=20;
    card.style.position='fixed';
    card.style.top=`${top}px`;
    card.style.left=`${left}px`;
    card.style.zIndex=10000;
    card.innerHTML=`<h2>Workspace Basics</h2><p>Tap or click the canvas to open the Action Menu. From there you can launch tools, spells and more.</p><div class='st-onboard-actions' style='justify-content:flex-end;'><button class='st-onboard-next'>Next</button><button class='st-onboard-skip'>Skip</button></div>`;
    root.appendChild(card);

    const finish=()=>{ cleanup(); card.remove(); next(); };
    card.querySelector('.st-onboard-next').addEventListener('click',finish,{once:true});
    card.querySelector('.st-onboard-skip').addEventListener('click',()=>{cleanup(); skip();},{once:true});
  }

  findTarget(stage){
    const nodes = Array.from(document.querySelectorAll(stage.selector));
    if (stage.filterFn) return nodes.find(stage.filterFn);
    return nodes[0]||null;
  }

  makeCard(title, body, rect){
    const overlay = document.createElement('div');
    overlay.className='st-onboard-overlay no-bg';
    this.root.appendChild(overlay);
    this.cleanupFns.push(()=>overlay.remove());

    const card=document.createElement('div');
    card.className='st-onboard-card';
    // Position to the right or below target if possible
    const margin=12;
    let top=rect.bottom+margin;
    let left=rect.left;
    if(top+200>window.innerHeight){ // flip above
      top=rect.top-200-margin;
    }
    if(left+320>window.innerWidth){
      left=window.innerWidth-340;
    }
    card.style.position='fixed';
    card.style.top=`${Math.max(20,top)}px`;
    card.style.left=`${Math.max(20,left)}px`;
    card.style.zIndex=10000;
    card.innerHTML=`<h2>${title}</h2><p>${body}</p><div class="st-onboard-actions" style="justify-content:flex-end;"><button class="st-onboard-skip">Skip Tour</button></div>`;
    this.root.appendChild(card);
    this.cleanupFns.push(()=>card.remove());
    return card;
  }

  waitFor(cond, cb, retries=40){
    if(cond()) { cb(); return; }
    if(retries===0){ cb(); return; }
    setTimeout(()=>this.waitFor(cond,cb,retries-1),150);
  }

  cleanup(){
    clearTimeout(this.autoTimer);
    if(this.highlightEl) this.highlightEl.classList.remove('st-onboarding-highlight');
    this.highlightEl=null;
    if(this.cleanupFns){ this.cleanupFns.forEach(fn=>fn()); }
    this.cleanupFns=[];
    this.root.innerHTML='';
  }
} 