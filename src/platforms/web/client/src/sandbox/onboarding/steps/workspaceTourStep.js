export default class WorkspaceTourStep {
  constructor() {
    this.id = 'workspace-tour';
    this.stageIndex = 0;
    this.stages = [
      {
        title: 'Open the Action Menu',
        body: 'Click anywhere on the workspace to open the action menu.',
        selector: '.sandbox-canvas, .sandbox-content',
        afterWait: () => document.querySelector('.action-modal.active')
      },
      {
        title: 'Choose “Create”',
        body: 'In the menu, click the <b>Create</b> button to start a new generation.',
        selector: '.action-modal.active .create-btn',
        afterWait: () => document.querySelector('.create-submenu.active')
      },
      {
        title: 'Select Image Output',
        body: 'Pick the <b>Image</b> option – we want to generate a picture.',
        selector: '.create-submenu.active [data-type="image"]',
        afterWait: () => {
          // wait a short moment for tools to render
          return document.querySelector('.tool-button');
        }
      },
      {
        title: 'Pick “quickmake” Tool',
        body: 'Click the <b>quickmake</b> tool – a fast image generator.',
        selector: '.tool-button', // we will filter in code
        filterFn: (el)=>el.textContent.toLowerCase().includes('quickmake'),
        afterWait: () => Array.from(document.querySelectorAll('.tool-window')).some(w=>w.textContent.toLowerCase().includes('quickmake'))
      }
    ];
  }

  render(root, next) {
    this.root = root;
    this.next = next;
    this.showCurrentStage();
  }

  showCurrentStage() {
    this.cleanup();
    if (this.stageIndex >= this.stages.length) {
      this.next();
      return;
    }
    const stage = this.stages[this.stageIndex];
    const target = this.findTarget(stage);
    if (!target) {
      // retry until target appears
      setTimeout(()=>this.showCurrentStage(), 300);
      return;
    }
    // Highlight
    target.classList.add('st-onboarding-highlight');
    this.highlightEl = target;

    // Position card
    const rect = target.getBoundingClientRect();
    const card = this.makeCard(stage.title, stage.body, rect);

    // Skip listener
    card.querySelector('.st-onboard-skip').addEventListener('click', ()=>{
      this.next();
    });

    // Click listener to advance
    const advance = ()=>{
      target.removeEventListener('click', advanceWrapper, true);
      // wait for afterWait condition if defined
      const awaitCond = stage.afterWait;
      if (awaitCond) {
        this.waitFor(awaitCond, ()=>{
          this.stageIndex++;
          this.showCurrentStage();
        });
      } else {
        this.stageIndex++;
        this.showCurrentStage();
      }
    };
    const advanceWrapper = ()=>setTimeout(advance, 50); // slight delay
    target.addEventListener('click', advanceWrapper, true);
    this.cleanupFns.push(()=>target.removeEventListener('click', advanceWrapper, true));

    // Auto click fallback after 8s
    this.autoTimer = setTimeout(()=>{
      if (target) target.click();
    }, 8000);
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