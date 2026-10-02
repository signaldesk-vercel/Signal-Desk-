import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createClerkClient, verifyToken } from '@clerk/backend';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import crypto from 'node:crypto';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
const PRICE_ID='pri_01m3pxczzqkv25fj4mhz66kjmb';
const PRODUCT_ID='pro_01m3px99f58awgx0k8hsd3rd4q';

const send=(res:VercelResponse,status:number,data:any)=>res.status(status).json(data);
const tokenOf=(body:any,req:VercelRequest)=>String(body?.clerkToken||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')).trim();

async function currentUser(body:any,req:VercelRequest){
 const token=tokenOf(body,req); if(!token)return null;
 try{
  const claims=await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY!});
  const id=String(claims.sub||''); if(!id)return null;
  const cu=await clerk.users.getUser(id);
  const name=cu.fullName||[cu.firstName,cu.lastName].filter(Boolean).join(' ')||'SignalDesk user';
  const email=cu.primaryEmailAddress?.emailAddress||'';
  const {data:existing}=await supabase.from('clerk_users').select('*').eq('clerk_id',id).maybeSingle();
  if(existing){
   if(existing.name!==name||existing.email!==email) await supabase.from('clerk_users').update({name,email,updated_at:new Date().toISOString()}).eq('clerk_id',id);
   return {...existing,name,email};
  }
  const {data:ws,error:we}=await supabase.from('workspaces').insert({name:'My SignalDesk workspace'}).select().single();
  if(we||!ws)return null;
  const {data:u,error:ue}=await supabase.from('clerk_users').insert({clerk_id:id,name,email,workspace_id:ws.id,currency:'USD'}).select().single();
  if(ue||!u)return null;
  return u;
 }catch{return null}
}
const okUser=async(body:any,req:VercelRequest,res:VercelResponse)=>{const u=await currentUser(body,req);if(!u){send(res,401,{message:'Unauthorized'});return null}return u};
async function openRouter(messages:any[],max_tokens=420){
 const key=process.env.OPENROUTER_API_KEY; if(!key)throw new Error('OPENROUTER_API_KEY is not configured');
 const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','HTTP-Referer':process.env.APP_URL||'https://signaldesk.vercel.app','X-OpenRouter-Title':'SignalDesk'},body:JSON.stringify({models:['~openai/gpt-latest','~anthropic/claude-sonnet-latest'],provider:{allow_fallbacks:true},messages,max_tokens,temperature:.55})});
 if(!r.ok)throw new Error('OpenRouter request failed: '+r.status);
 const d:any=await r.json(); return {text:String(d?.choices?.[0]?.message?.content||'').trim(),model:String(d?.model||'OpenRouter model')};
}
const fallback=(content:string)=>{const clean=content.replace(/\s+/g,' ').trim();const hot=/buy|budget|ready|proposal|price|contract|renew/i.test(clean);return {customer:'Captured signal',channel:'Captured note',title:hot?'High-intent follow-up':'Business signal',preview:clean.length>110?clean.slice(0,107)+'...':clean,time:'Just now',priority:hot?'High':'Medium',insight:hot?'The context contains a clear commercial signal. Move the conversation toward a concrete next step.':'There is useful context here. Convert it into one explicit action before it gets lost.',action:hot?'Respond with a concrete next step':'Create one follow-up action'}};
async function understand(content:string){try{const r=await openRouter([{role:'system',content:'Turn business context into JSON with customer, channel, title, preview, priority, insight, action. Never invent facts; use Captured signal when a name is absent. JSON only.'},{role:'user',content}],400);return JSON.parse(r.text)}catch{return fallback(content)}}
async function convertFile(name:string,mime:string,data:string){
 const raw=data.includes(',')?data.split(',').pop()!:data;const buf=Buffer.from(raw,'base64');if(buf.length>12*1024*1024)throw new Error('File is too large. Please keep uploads under 12 MB.');
 const lower=name.toLowerCase();
 if(lower.endsWith('.pdf')||mime==='application/pdf')return (await pdfParse(buf)).text.trim();
 if(lower.endsWith('.docx'))return (await mammoth.extractRawText({buffer:buf})).value.trim();
 if(lower.endsWith('.xlsx')||lower.endsWith('.xls')||lower.endsWith('.csv')||mime.includes('spreadsheet')||mime==='text/csv'){const wb=XLSX.read(buf,{type:'buffer'});return wb.SheetNames.map(n=>'Sheet: '+n+'\n'+XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n').trim()}
 if(lower.endsWith('.txt')||lower.endsWith('.md')||mime.startsWith('text/'))return buf.toString('utf8').trim();
 throw new Error('Unsupported file type. Use PDF, TXT, CSV, XLS, XLSX, DOCX or Markdown.');
}
async function billingConfig(res:VercelResponse){const key=String(process.env.PADDLE_API_KEY||'').replace(/^Bearer\s+/i,'').trim();const token=String(process.env.PADDLE_CLIENT_TOKEN||'').replace(/^Bearer\s+/i,'').trim();const environment=/^pdl_sdbx_/.test(key)||token.startsWith('test_')?'sandbox':'live';return send(res,200,{configured:Boolean(key&&token),clientToken:token,priceId:PRICE_ID,productId:PRODUCT_ID,environment})}
async function paddleValidate(res:VercelResponse){
 const key=String(process.env.PADDLE_API_KEY||'').replace(/^Bearer\s+/i,'').trim();if(!key)return send(res,200,{ok:false,code:'PADDLE_API_KEY_MISSING',message:'Paddle API key is missing'});
 const token=String(process.env.PADDLE_CLIENT_TOKEN||'').replace(/^Bearer\s+/i,'').trim();if(!token)return send(res,200,{ok:false,code:'PADDLE_CLIENT_TOKEN_MISSING',message:'Paddle client token is missing'});
 const env=token.startsWith('test_')?'sandbox':'live';const base=env==='sandbox'?'https://sandbox-api.paddle.com':'https://api.paddle.com';
 try{const r=await fetch(base+'/prices/'+PRICE_ID,{headers:{Authorization:'Bearer '+key,'Paddle-Version':'1',Accept:'application/json'}});const d:any=await r.json();if(!r.ok)return send(res,200,{ok:false,code:String(d?.error?.code||('HTTP_'+r.status)),status:r.status,environment:env,message:String(d?.error?.detail||'Paddle price validation failed')});return send(res,200,{ok:true,environment:env,priceId:d?.data?.id||PRICE_ID,productId:d?.data?.product_id||''})}catch(e:any){return send(res,200,{ok:false,code:'PADDLE_VALIDATION_ERROR',message:e?.message||'Could not validate Paddle configuration'})}
}
async function paddleWebhook(req:VercelRequest,res:VercelResponse){
 const signature=String(req.headers['paddle-signature']||'');const secret=process.env.PADDLE_WEBHOOK_SECRET||'';if(!signature||!secret)return send(res,400,{message:'Paddle signature is required'});
 const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});const parts=Object.fromEntries(signature.split(';').map(x=>{const [k,...v]=x.split('=');return [k,v.join('=')]}));const ts=String(parts.ts||'');const sigs=signature.split(';').filter(x=>x.startsWith('h1=')).map(x=>x.slice(3));const expected=crypto.createHmac('sha256',secret).update(ts+':'+raw).digest('hex');if(!ts||Math.abs(Date.now()-Number(ts)*1000)>5000||!sigs.some(s=>s.length===expected.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected))))return send(res,401,{message:'Invalid Paddle signature'});
 const p:any=JSON.parse(raw);const eventId=String(p.event_id||p.id||'');if(eventId){const {data:dupe}=await supabase.from('paddle_events').select('id').eq('event_id',eventId).maybeSingle();if(dupe)return send(res,200,{ok:true,duplicate:true});await supabase.from('paddle_events').insert({event_id:eventId,type:String(p.event_type||'')})}
 if(String(p.event_type||'').startsWith('subscription.')){const d=p.data||{},custom=d.custom_data||{},clerkId=String(custom.signaldesk_user_id||'');let workspaceId=null;if(clerkId){const {data:u}=await supabase.from('clerk_users').select('workspace_id').eq('clerk_id',clerkId).maybeSingle();workspaceId=u?.workspace_id||null}const record={user_id:null,workspace_id:workspaceId,subscription_id:String(d.id||''),status:String(d.status||'unknown'),customer_id:String(d.customer_id||''),price_id:String(d.items?.[0]?.price?.id||'')};const {data:old}=await supabase.from('billing_subscriptions').select('id').eq('subscription_id',record.subscription_id).maybeSingle();if(old)await supabase.from('billing_subscriptions').update(record).eq('id',old.id);else await supabase.from('billing_subscriptions').insert(record)}
 return send(res,200,{ok:true});
}
export default async function handler(req:VercelRequest,res:VercelResponse){
 const rawPath='/'+String(req.query.path||'').replace(/^\/+|\/+$/g,'');const path=rawPath.startsWith('/api/')?rawPath:'/api'+rawPath;const body:any=req.body||{};
 if(path==='/api/auth/config')return send(res,200,{publishableKey:process.env.CLERK_PUBLISHABLE_KEY||''});
 if(path==='/api/billing/webhook')return paddleWebhook(req,res);
 if(req.method!=='POST')return send(res,405,{message:'Method not allowed'});
 if(path==='/api/billing/config'){const u=await okUser(body,req,res);if(!u)return;return billingConfig(res)}
 if(path==='/api/billing/validate'){const u=await okUser(body,req,res);if(!u)return;return paddleValidate(res)}
 const u=await okUser(body,req,res);if(!u)return;
 if(path==='/api/workspace'){const [c,co,t]=await Promise.all([supabase.from('customers').select('*').eq('workspace_id',u.workspace_id),supabase.from('conversations').select('*').eq('workspace_id',u.workspace_id).order('created_at',{ascending:false}),supabase.from('transactions').select('*').eq('workspace_id',u.workspace_id).order('date',{ascending:false})]);return send(res,200,{user:{id:u.clerk_id,name:u.name,email:u.email,workspaceId:u.workspace_id,currency:u.currency},customers:(c.data||[]).map(x=>({...x,workspaceId:x.workspace_id})),conversations:(co.data||[]).map(x=>({...x,workspaceId:x.workspace_id, time:x.time||'Just now'})),transactions:(t.data||[]).map(x=>({...x,workspaceId:x.workspace_id}))})}
 if(path==='/api/profile'){const currency=String(body.currency||'USD');if(!['USD','LKR','EUR','GBP'].includes(currency))return send(res,400,{message:'Unsupported currency'});await supabase.from('clerk_users').update({currency,updated_at:new Date().toISOString()}).eq('clerk_id',u.clerk_id);return send(res,200,{ok:true,currency})}
 if(path==='/api/customers'){const name=String(body.name||'').trim();if(!name)return send(res,400,{message:'Customer name is required'});const row={workspace_id:u.workspace_id,name,email:String(body.email||''),status:'New',value:0,initials:name.split(/\s+/).slice(0,2).map((x:string)=>x[0]).join('').toUpperCase()};const {data,error}=await supabase.from('customers').insert(row).select().single();if(error)return send(res,500,{message:error.message});return send(res,200,{customer:{...data,workspaceId:data.workspace_id}})}
 if(path==='/api/transactions'){const amount=Number(body.amount);if(!Number.isFinite(amount)||amount<=0||!['income','expense'].includes(body.type)||!String(body.label||'').trim())return send(res,400,{message:'Valid amount, type and description are required'});const row={workspace_id:u.workspace_id,type:body.type,label:String(body.label).trim(),amount,date:String(body.date||new Date().toISOString().slice(0,10))};const {data,error}=await supabase.from('transactions').insert(row).select().single();if(error)return send(res,500,{message:error.message});return send(res,200,{transaction:{...data,workspaceId:data.workspace_id}})}
 if(path==='/api/conversations'){if(!String(body.content||'').trim())return send(res,400,{message:'Content is required'});const a=await understand(String(body.content));const row={workspace_id:u.workspace_id,content:String(body.content),...a};const {data,error}=await supabase.from('conversations').insert(row).select().single();if(error)return send(res,500,{message:error.message});return send(res,200,{conversation:{...data,workspaceId:data.workspace_id}})}
 if(path==='/api/files/convert'){try{const text=await convertFile(String(body.fileName||''),String(body.mimeType||''),String(body.data||''));return send(res,200,{fileName:String(body.fileName||''),text,stored:false})}catch(e:any){return send(res,422,{message:e?.message||'Could not convert this file'})}}
 if(path==='/api/ai/reply'){try{const r=await openRouter([{role:'system',content:'Write a concise customer reply. Never invent commitments or facts.'},{role:'user',content:JSON.stringify(body.conversation)}],300);return send(res,200,{reply:r.text,provider:'openrouter',model:r.model})}catch{return send(res,200,{reply:'AI is temporarily unavailable. Review the conversation and write the response manually.',provider:'local-fallback'})}}
 if(path==='/api/ai/mentor'){const q=String(body.question||'').trim();if(!q)return send(res,400,{message:'Question is required'});try{const r=await openRouter([{role:'system',content:'You are SignalDesk Business Mentor, an AI assistant and trainer for entrepreneurs. Answer directly, teach clearly, give practical next steps, and never invent workspace facts.'},...(Array.isArray(body.history)?body.history.slice(-8):[]),{role:'user',content:'Workspace context: '+JSON.stringify(body.context||{})+'\n\nQuestion: '+q}],420);return send(res,200,{advice:r.text,provider:'openrouter',model:r.model})}catch{return send(res,200,{advice:'Break the question into the goal, the evidence you have, and one next action you can test this week.',provider:'local-fallback'})}}
 if(path==='/api/billing/status'){const {data}=await supabase.from('billing_subscriptions').select('*').eq('workspace_id',u.workspace_id).order('updated_at',{ascending:false}).limit(1);const sub=data?.[0]||null;return send(res,200,{active:Boolean(sub&&['active','trialing'].includes(sub.status)),subscription:sub})}
 if(path==='/api/social/review'){const url=String(body.url||'').trim(),platform=String(body.platform||'Social media');if(!/^https?:\/\//i.test(url))return send(res,400,{message:'Enter a valid public URL.'});try{const rr=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 SignalDesk','Accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.7'}});const raw=await rr.text();const source=raw.replace(/<script[\\s\\S]*?<\\/script>/gi,' ').replace(/<style[\\s\\S]*?<\\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim().slice(0,16000);if(!rr.ok||!source)return send(res,200,{ok:false,message:'The public page could not be read.'});const r=await openRouter([{role:'system',content:'Analyze only supplied public page content. Never invent followers, engagement, demographics, products or performance. Return JSON only with analysis, strengths, opportunities, nextSteps, contentIdeas, updates.'},{role:'user',content:'Platform: '+platform+'\nURL: '+url+'\nPAGE: '+source}],900);const x=JSON.parse(r.text);const result={ok:true,url,title:'',status:rr.status,analysis:String(x.analysis||''),strengths:x.strengths||[],opportunities:x.opportunities||[],nextSteps:x.nextSteps||[],contentIdeas:x.contentIdeas||[],updates:x.updates||[]};await supabase.from('social_reviews').insert({workspace_id:u.workspace_id,platform,url,analysis:result.analysis,strengths:result.strengths,opportunities:result.opportunities,next_steps:result.nextSteps,content_ideas:result.contentIdeas,updates:result.updates});return send(res,200,result)}catch(e:any){return send(res,200,{ok:false,message:e?.message||'Social analysis is temporarily unavailable.'})}}
 return send(res,404,{message:'Not found'});
}
