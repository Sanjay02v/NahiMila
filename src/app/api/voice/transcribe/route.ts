import { NextResponse } from 'next/server';
import { shopActor } from '@/lib/product/auth';
import { failure } from '@/lib/product/http';
import { assertSameOrigin } from '@/lib/same-origin';
export const runtime='nodejs';
const limits=new Map<string,{count:number;until:number}>();
export async function POST(req:Request){
 try{
  const shop=await shopActor();
  const key=process.env.SARVAM_API_KEY;if(!key)return NextResponse.json({error:'Sarvam is not configured. Please use typed entry.'},{status:503});
  assertSameOrigin(req);
  if(Number(req.headers.get('content-length'))>4000000)throw new Error('Please record a shorter request. Maximum file size is 3 MB.');
  const ip=shop.id;const now=Date.now();const entry=limits.get(ip);if(entry&&entry.until>now&&entry.count>=6)return NextResponse.json({error:'Voice limit reached. Wait a minute or use typed entry.'},{status:429});
  if(limits.size>1000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
  limits.set(ip,{count:entry&&entry.until>now?entry.count+1:1,until:entry&&entry.until>now?entry.until:now+60000});
  const form=await req.formData();const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>3000000)throw new Error('Record a short audio request (up to 3 MB).');
  if(!['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/mpeg'].includes(file.type.split(';')[0]))throw new Error('Unsupported audio format. Please use the microphone recorder.');
  const outbound=new FormData();outbound.append('file',file);outbound.append('model','saaras:v4');outbound.append('language_code','unknown');
  const response=await fetch('https://api.sarvam.ai/speech-to-text',{method:'POST',headers:{'api-subscription-key':key},body:outbound,signal:AbortSignal.timeout(25000)});
  if(!response.ok)return NextResponse.json({error:`Sarvam could not transcribe this request (${response.status}). Retry or use typed entry.`},{status:502});
  const result=await response.json();if(typeof result.transcript!=='string'||!result.transcript.trim())throw new Error('No clear speech was recognised. Try again or type the request.');
  return NextResponse.json({transcript:result.transcript,language_code:result.language_code,provider:'Sarvam',requires_review:true});
 }catch(e){return failure(e);}
}
