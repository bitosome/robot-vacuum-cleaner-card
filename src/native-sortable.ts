/** Load HA's own sortable through its built-in entities editor chunk.
 * No private asset URLs, bundled Sortable fork, or replacement custom element.
 */
let loading: Promise<boolean> | undefined;
export function loadNativeSortable(): Promise<boolean> {
  if (customElements.get('ha-sortable')) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    const host=window as typeof window & {loadCardHelpers?:()=>Promise<{createCardElement:(config:unknown)=>HTMLElement}>};
    if (!host.loadCardHelpers) return false;
    const helpers=await host.loadCardHelpers();
    helpers.createCardElement({type:'entities',entities:[]});
    if(!customElements.get('hui-entities-card')) {
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Native card loader timed out')),10000);
        void customElements.whenDefined('hui-entities-card').then(()=>{clearTimeout(timeout);resolve();});
      });
    }
    const ctor=customElements.get('hui-entities-card')! as typeof HTMLElement & {getConfigElement?:()=>Promise<HTMLElement>};
    await ctor.getConfigElement?.();
    return !!customElements.get('ha-sortable');
  })().catch(()=>false).finally(()=>{loading=undefined;});
  return loading;
}
