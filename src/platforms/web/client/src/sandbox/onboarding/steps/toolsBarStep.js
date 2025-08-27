export default class ToolsBarStep {
  constructor(){ this.id='tools-bar'; }
  render(root,next,skip){
    const bar=document.querySelector('.tools-sidebar, .tool-bar, #tools-sidebar');
    if(!bar){ next(); return; }
    bar.classList.add('st-onboarding-highlight');
    const cleanup=()=>bar.classList.remove('st-onboarding-highlight');

    const rect=bar.getBoundingClientRect();
    const card=document.createElement('div');
    card.className='st-onboard-card';
    const margin=12;
    let top=rect.top;
    let left=rect.right+margin;
    if(left+300>window.innerWidth){ left=rect.left-320-margin; }
    if(left<20) left=20;
    if(top+180>window.innerHeight) top=window.innerHeight-200;
    card.style.position='fixed';
    card.style.top=`${top}px`;
    card.style.left=`${left}px`;
    card.style.zIndex=10000;
    card.innerHTML=`<h2>All Tools</h2><p>Browse every available tool, search by name, and click one to add it to the canvas start creating.</p><div class='st-onboard-actions' style='justify-content:flex-end;'><button class='st-onboard-next'>Next</button><button class='st-onboard-skip'>Skip</button></div>`;
    root.appendChild(card);
    const finish=()=>{ cleanup(); card.remove(); next(); };
    card.querySelector('.st-onboard-next').addEventListener('click',finish,{once:true});
    card.querySelector('.st-onboard-skip').addEventListener('click',()=>{cleanup(); skip();},{once:true});
  }
}
