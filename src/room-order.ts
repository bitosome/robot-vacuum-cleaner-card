/** The visible order owns the sequence; toggles only control membership. */
export function reconcileOrder(preferred: readonly string[], available: readonly string[]): string[] {
  const valid = new Set(available);
  return [...new Set([...preferred.filter(id => valid.has(id)), ...available])];
}

export function moveRoom(order: readonly string[], id: string, index: number): string[] {
  if (!order.includes(id)) return [...order];
  const next = order.filter(value => value !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

/** Pointer events support touch/pen/mouse; keyboard remains an independent path.
 * Only the handle owns touch-action:none, so the rest of a room still scrolls.
 */
export class RoomDrag {
  private session?: {id:string; pointer:number; startY:number; y:number; original:string[]; moved:boolean; handle:HTMLElement};
  private frame?: number;
  constructor(private host:HTMLElement, private options:{
    enabled:()=>boolean; order:()=>string[]; change:(order:string[])=>void;
    active:(id?:string)=>void; announce:(id:string)=>void;
  }) {}

  start(event:PointerEvent, id:string) {
    if (!this.options.enabled() || event.button!==0 || event.isPrimary===false) return;
    this.cancel();
    const handle=event.currentTarget as HTMLElement;
    this.session={id,pointer:event.pointerId,startY:event.clientY,y:event.clientY,
      original:this.options.order(),moved:false,handle};
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove',this.move,{passive:false});
    window.addEventListener('pointerup',this.end);
    window.addEventListener('pointercancel',this.abort);
    window.addEventListener('keydown',this.escape);
  }

  private move=(event:PointerEvent)=>{
    const s=this.session;
    if (!s || event.pointerId!==s.pointer) return;
    if (!this.options.enabled()) { this.cancel(); return; }
    s.y=event.clientY;
    if (!s.moved && Math.abs(s.y-s.startY)<6) return;
    event.preventDefault();
    if (!s.moved) {s.moved=true;this.options.active(s.id);this.frame=requestAnimationFrame(this.scroll);}
    this.reorder();
  };
  private reorder() {
    const s=this.session;if(!s || !s.moved)return;
    const items=[...this.host.shadowRoot!.querySelectorAll<HTMLElement>('[data-room-item]')];
    let index=-1,distance=Infinity;
    items.forEach((item,i)=>{
      const r=item.getBoundingClientRect(),d=Math.abs(s.y-(r.top+r.height/2));
      if(r.height>0 && d<distance){distance=d;index=i;}
    });
    const order=this.options.order();
    if(index>=0 && order[index]!==s.id)this.options.change(moveRoom(order,s.id,index));
  }
  private scroll=()=>{
    const s=this.session;
    if(!s || !s.moved)return;
    if(!this.options.enabled()){this.cancel();return;}
    // Find the native dashboard's scroll owner, crossing shadow boundaries.
    let node:Element|null=this.host,scroller:Element|null=null;
    while(node){
      if(node.scrollHeight>node.clientHeight+1 && /auto|scroll/.test(getComputedStyle(node).overflowY)){scroller=node;break;}
      node=node.parentElement??(node.getRootNode() instanceof ShadowRoot?(node.getRootNode() as ShadowRoot).host:null);
    }
    scroller??=document.scrollingElement;
    if(scroller){
      const r=scroller===document.scrollingElement?{top:0,bottom:window.innerHeight}:scroller.getBoundingClientRect();
      const speed=s.y<r.top+56?-Math.min(14,(r.top+56-s.y)/4):s.y>r.bottom-56?Math.min(14,(s.y-r.bottom+56)/4):0;
      if(speed){scroller.scrollTop+=speed;this.reorder();}
    }
    this.frame=requestAnimationFrame(this.scroll);
  };
  private end=(event:PointerEvent)=>{
    if(event.pointerId!==this.session?.pointer)return;
    const s=this.session;
    if(!this.options.enabled()){this.cancel();return;}
    this.clear();
    if(s.moved)this.options.announce(s.id);
  };
  private abort=(event:PointerEvent)=>{if(event.pointerId===this.session?.pointer)this.cancel();};
  private escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();this.cancel();}};
  cancel(){
    const s=this.session;this.clear();
    if(s?.moved && this.options.enabled())this.options.change(s.original);
  }
  private clear(){
    const s=this.session;this.session=undefined;
    if(s?.handle.hasPointerCapture?.(s.pointer))s.handle.releasePointerCapture(s.pointer);
    if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;
    window.removeEventListener('pointermove',this.move);
    window.removeEventListener('pointerup',this.end);
    window.removeEventListener('pointercancel',this.abort);
    window.removeEventListener('keydown',this.escape);
    this.options.active();
  }
}
