import type { AppRecord } from '../../shared/src/index.js';
type Call = (method:string,args:Record<string,unknown>)=>Promise<any>;
export function createClient(call:Call) {
  return {
    data: { collection: (collection:string) => ({
      list: (options:{limit?:number;cursor?:string}={}) => call('data',{...options,collection,operation:'list'}) as Promise<{items:AppRecord[];next_cursor:string|null}>,
      get: (id:string) => call('data',{collection,operation:'get',id}) as Promise<AppRecord>,
      insert: (payload:Record<string,unknown>,idempotency_key=crypto.randomUUID()) => call('data',{collection,operation:'insert',payload,idempotency_key}) as Promise<AppRecord>,
      update: (id:string,payload:Record<string,unknown>,revision:number) => call('data',{collection,operation:'update',id,payload,revision}) as Promise<AppRecord>,
      delete: (id:string,revision:number) => call('data',{collection,operation:'delete',id,revision}),
    }) },
    functions: { invoke:(name:string,input:unknown={})=>call('function',{name,input}) },
  };
}
// Included by the trusted publisher, before application scripts. No bearer token enters the iframe.
export const browserSdk = `(() => {
  let port; const pending = new Map(); const queue = [];
  window.addEventListener('message', e => {
    if (e.source !== parent || e.data?.type !== 'coship:connect' || !e.ports[0] || port) return;
    port = e.ports[0];
    port.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); clearTimeout(p.timer); e.data.error ? p.reject(Object.assign(new Error(e.data.error.message),{code:e.data.error.code})) : p.resolve(e.data.result); };
    queue.splice(0).forEach(m => port.postMessage(m));
  });
  function call(method,args) { return new Promise((resolve,reject) => {
    if(pending.size>=32) return reject(new Error('Слишком много запросов'));
    const id = crypto.randomUUID(), timer=setTimeout(()=>{pending.delete(id);reject(new Error('Истекло время ожидания'));},30000);
    pending.set(id,{resolve,reject,timer}); const message={id,method,args}; port?port.postMessage(message):queue.push(message);
  }); }
  window.coship = {
    data: { collection: collection => ({
      list: (opts={}) => call('data',{...opts,collection,operation:'list'}),
      get: id => call('data',{collection,operation:'get',id}),
      insert: (payload,idempotency_key=crypto.randomUUID()) => call('data',{collection,operation:'insert',payload,idempotency_key}),
      update: (id,payload,revision) => call('data',{collection,operation:'update',id,payload,revision}),
      delete: (id,revision) => call('data',{collection,operation:'delete',id,revision})
    }) },
    functions: { invoke: (name,input={}) => call('function',{name,input}) }
  };
})();`;
