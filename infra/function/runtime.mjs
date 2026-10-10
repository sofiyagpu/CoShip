import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
const pending=new Map();let started=false;
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
// Application stdout must not become a cross-user log or corrupt the RPC stream.
console.log=console.info=console.warn=console.error=console.debug=()=>{};
const lines=readline.createInterface({input:process.stdin});
function data(args){return new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});send({type:'data',id,args})})}
const ctx={data:{collection:collection=>({
  list:(options={})=>data({...options,operation:'list',collection}),
  get:id=>data({operation:'get',collection,id}),
  insert:(payload,idempotency_key=randomUUID())=>data({operation:'insert',collection,payload,idempotency_key}),
  update:(id,payload,revision)=>data({operation:'update',collection,id,payload,revision}),
  delete:(id,revision)=>data({operation:'delete',collection,id,revision}),
})}};
lines.on('line',async line=>{
  let message;try{message=JSON.parse(line)}catch{return send({type:'error'})}
  if(started){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result)}return}
  started=true;
  try{const module=await import(`data:text/javascript;base64,${Buffer.from(message.code).toString('base64')}`);if(typeof module.default!=='function')throw new Error('No default function');const result=await module.default(message.input,ctx);send({type:'result',value:result??null})}catch{send({type:'error'})}
});
