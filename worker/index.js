import { buildPushPayload } from '@block65/webcrypto-web-push';
import { dateParts, summary, validatePlan } from '../src/model.js';

export function allowedEndpoint(endpoint){
 try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(
 u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'))}catch{return false}
}
export function inHours(hour,start,end){return start<=end?hour>=start&&hour<=end:hour>=start||hour<=end}
function json(data,status=200,origin=''){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'}})}
async function db(env,path,options={}){
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error('Database operation failed');error.status=response.status;throw error}
 const text=await response.text();return text?JSON.parse(text):null;
}
async function claim(env,user,slot){
 try{await db(env,'push_deliveries',{method:'POST',body:JSON.stringify({user_id:user,slot}),headers:{Prefer:'return=minimal'}});return true}catch(error){if(error.status===409)return false;throw error}
}
async function devices(env,user){return db(env,`push_subscriptions?user_id=eq.${encodeURIComponent(user)}&select=id,endpoint,subscription`)}
async function send(env,device,message){
 if(!allowedEndpoint(device.endpoint)||device.subscription?.endpoint!==device.endpoint)return false;
 const payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:3600}},device.subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
 const response=await fetch(device.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===404||response.status===410){await db(env,`push_subscriptions?id=eq.${encodeURIComponent(device.id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return false}
 return response.ok;
}
export async function runSchedule(env,now=new Date()){
 // Pagination supports more users without silently ignoring rows beyond PostgREST's cap.
 for(let offset=0;;offset+=100){
 const settings=await db(env,`notification_settings?enabled=eq.true&select=*&order=user_id&limit=100&offset=${offset}`);
 for(const setting of settings){
  try{const local=dateParts(now,setting.timezone);if(local.minute!==0||!inHours(local.hour,setting.start_hour,setting.end_hour))continue;
   const plans=await db(env,`planners?user_id=eq.${setting.user_id}&select=data`);if(!plans.length)continue;
   const plan=validatePlan(plans[0].data);if(plan.timezone!==setting.timezone)continue;
   const subscriptions=await devices(env,setting.user_id);if(!subscriptions.length)continue;
   const slot=`hour:${now.toISOString().slice(0,13)}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
   if(!await claim(env,setting.user_id,slot))continue;
   const results=await Promise.allSettled(subscriptions.map(device=>send(env,device,summary(plan,now))));
   if(results.some(r=>r.status==='rejected'||!r.value))console.warn('Some hourly notifications were not delivered.');
  }catch{console.error('A scheduled notification could not be processed.')}
 }
 if(settings.length<100)break;
 }
 // Keep the free database small. Retain a week of deduplication records.
 await db(env,`push_deliveries?created_at=lt.${encodeURIComponent(new Date(now.getTime()-7*86400000).toISOString())}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');if(origin!==env.APP_ORIGIN)return json({error:'Origin not allowed.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'}});
  try{
   const path=new URL(request.url).pathname;
   if(path==='/public-key'&&request.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY},200,origin);
   if(path!=='/test'||request.method!=='POST')return json({error:'Not found.'},404,origin);
   const authorization=request.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))return json({error:'Log in first.'},401,origin);
   const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:authorization},signal:AbortSignal.timeout(15000)});
   if(!auth.ok)return json({error:'Your login has expired. Log in again.'},401,origin);
   const user=await auth.json();
   const list=await devices(env,user.id);if(!list.length)return json({error:'Enable notifications on a device first.'},400,origin);
   if(!await claim(env,user.id,`test:${Math.floor(Date.now()/60000)}`))return json({error:'Please wait a minute before another test.'},429,origin);
   const results=await Promise.allSettled(list.map(device=>send(env,device,{title:'Dayline is connected',body:'Your hourly progress updates will arrive here.',tag:'dayline-test'})));
   if(!results.some(r=>r.status==='fulfilled'&&r.value))return json({error:'No device accepted the notification. Reconnect this device and retry.'},502,origin);
   return json({sent:true},200,origin);
  }catch{return json({error:'Notification service unavailable. Please retry later.'},503,origin)}
 },
 async scheduled(event,env,ctx){ctx.waitUntil(runSchedule(env,new Date(event.scheduledTime)))}
};
