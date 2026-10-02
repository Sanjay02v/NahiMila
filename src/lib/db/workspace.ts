import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { MemoryStore, type SeedDataPayload } from './store';

const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const remote=url&&key?createClient(url,key,{auth:{persistSession:false}}):null;
export const storageMode=remote?'Supabase shared database':'Local persistent demo';
export const validWorkspace=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
type Document={revision:number;state:SeedDataPayload};
const globals=globalThis as unknown as {workspaceQueue?:Promise<unknown>};

async function load(id:string):Promise<Document|null> {
 if(remote){const {data,error}=await remote.from('demo_workspaces').select('revision,state').eq('id',id).maybeSingle();if(error)throw new Error('Database unavailable. Apply the demo workspace migration and check server credentials.');return data as Document|null;}
 if(process.env.VERCEL)throw new Error('Shared database is required on Vercel. Set Supabase server credentials before deploying.');
 try{return JSON.parse(await readFile(path.join(process.cwd(),'.data',`${id}.json`),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function save(id:string,expected:number,state:SeedDataPayload):Promise<boolean>{
 if(remote){const {data,error}=await remote.rpc('save_demo_workspace',{workspace_id:id,expected_revision:expected,new_state:state});if(error)throw new Error('Database transaction failed. Check the demo workspace migration.');return data===true;}
 const dir=path.join(process.cwd(),'.data');await mkdir(dir,{recursive:true});
 const file=path.join(dir,`${id}.json`),temp=`${file}.${crypto.randomUUID()}.tmp`;
 await writeFile(temp,JSON.stringify({revision:expected+1,state}));await rename(temp,file);return true;
}
// Remote compare-and-swap makes the recheck and complete state write one database transaction.
// Local serialization + atomic rename supports one Node server, including browser refresh/restarts.
export async function withWorkspace<T>(id:string,fn:(store:MemoryStore)=>T|Promise<T>,mutate=false):Promise<T>{
 if(!validWorkspace(id))throw new Error('Invalid demo workspace.');
 const execute=async()=>{
 for(let attempt=0;attempt<8;attempt++){
 const document=await load(id);const store=new MemoryStore(!document);if(document)store.hydrate(document.state);
 const result=await fn(store);
 if(!mutate&&document)return result;
 if(await save(id,document?.revision??-1,store.exportState()))return result;
 }
 throw new Error('Another device changed this order. Please retry with current data.');
 };
 if(remote)return execute();
 const next=(globals.workspaceQueue||Promise.resolve()).then(execute,execute);globals.workspaceQueue=next.catch(()=>{});return next;
}
export function snapshot(store:MemoryStore){return {...store.exportState(),evaluations:store.quotes.map(q=>store.evaluateQuote(q.id)),analyses:store.merchants.map(m=>store.getNoShowAnalysis(m.id)),storageMode,voiceAvailable:!!process.env.SARVAM_API_KEY};}
