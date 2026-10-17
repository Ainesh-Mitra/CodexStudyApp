import { scheduledNotifications, exampleNotification, validInterval } from '../src/notifications.js';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { validatePlan, emptyPlan } from '../src/model.js';

export function allowedEndpoint(endpoint){
 try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(
 u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'))}catch{return false}
}
export function inHours(hour,start,end){return start<=end?hour>=start&&hour<=end:hour>=start||hour<=end}
function json(data,status=200,origin=''){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...(origin?{'Access-Control-Allow-Origin':origin}:{}),'Vary':'Origin','Cache-Control':'no-store'}})}
function appOrigin(value){try{const url=new URL(value.trim());return ['https:','http:'].includes(url.protocol)&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password?url.origin:null}catch{return null}}
function configuration(env){
 const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','APP_ORIGIN','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
 const missing=required.filter(name=>!String(env[name]||'').trim());
 const invalid=[];
 if(env.APP_ORIGIN&&!appOrigin(env.APP_ORIGIN))invalid.push('APP_ORIGIN');
 if(env.SUPABASE_URL){try{const url=new URL(env.SUPABASE_URL);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)invalid.push('SUPABASE_URL')}catch{invalid.push('SUPABASE_URL')}}
 if(env.VAPID_PUBLIC_KEY&&!/^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY))invalid.push('VAPID_PUBLIC_KEY');
 if(env.VAPID_PRIVATE_KEY&&!/^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY))invalid.push('VAPID_PRIVATE_KEY');
 return {service:'dayline-push',configuration:missing.length||invalid.length?'needs_configuration':'configured',allowedOrigin:appOrigin(env.APP_ORIGIN),missing,invalid};
}
async function db(env,path,options={}){
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error('Database operation failed');error.status=response.status;error.stage='database';throw error}
 const text=await response.text();return text?JSON.parse(text):null;
}
async function claim(env,user,slot){
 try{await db(env,'push_deliveries',{method:'POST',body:JSON.stringify({user_id:user,slot}),headers:{Prefer:'return=minimal'}});return true}catch(error){if(error.status===409)return false;throw error}
}
async function devices(env,user){return db(env,`push_subscriptions?user_id=eq.${encodeURIComponent(user)}&select=id,endpoint,subscription`)}
export async function vapidKeysMatch(env){
 try{
  const raw=Uint8Array.from(atob(env.VAPID_PUBLIC_KEY.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const algorithm={name:'ECDSA',namedCurve:'P-256'};
  const privateKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:encode(raw.slice(1,33)),y:encode(raw.slice(33,65)),d:env.VAPID_PRIVATE_KEY},algorithm,false,['sign']);
  const publicKey=await crypto.subtle.importKey('raw',raw,algorithm,false,['verify']);
  const data=new TextEncoder().encode('Dayline notification key check'),signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,data);
  return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,data);
 }catch{return false}
}
async function send(env,device,message){
 if(!allowedEndpoint(device.endpoint))return {accepted:false,reason:'unsupported_service'};
 if(device.subscription?.endpoint!==device.endpoint)return {accepted:false,reason:'invalid_subscription'};
 let payload;
 try{payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:3600}},device.subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY})}catch{return {accepted:false,reason:'encryption'}}
 let response;try{response=await fetch(device.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(15000)})}catch{return {accepted:false,reason:'network'}}
 // Workers supports manual/follow only; never forward VAPID credentials to a redirect.
 if(response.status>=300&&response.status<400)return {accepted:false,reason:'redirect',status:response.status};
 if(response.status===404||response.status===410){await db(env,`push_subscriptions?id=eq.${encodeURIComponent(device.id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return {accepted:false,reason:'expired',status:response.status}}
 return {accepted:response.ok,reason:response.ok?'accepted':'rejected',status:response.status};
}
function deliveryError(results){
 const failure=results.find(r=>r.status==='fulfilled')?.value;
 if(!failure)return 'Push delivery failed inside the Worker. Check Worker logs and retry.';
 if(failure.reason==='expired')return 'The saved device subscription has expired. Disconnect this device, enable notifications again, then retry.';
 if(failure.reason==='unsupported_service')return 'This browser uses an unsupported push-service address. Try Chrome, Firefox, Edge, or an installed iPhone Home Screen app.';
 if(failure.reason==='invalid_subscription'||failure.reason==='encryption')return 'The saved device subscription could not be encrypted. Disconnect this device and enable notifications again.';
 if(failure.reason==='redirect')return 'The browser push service redirected the request. Delivery was blocked to protect your device credentials. Disconnect this device and enable notifications again.';
 if(failure.reason==='network')return 'The Worker could not reach the browser push service. Retry later; check Worker logs if this continues.';
 if(failure.status===401||failure.status===403)return `The browser push service rejected authentication (HTTP ${failure.status}). Check VAPID_SUBJECT uses your real mailto: email, then disconnect and reconnect this device with the current keys.`;
 return `The browser push service rejected the notification (HTTP ${failure.status}). Disconnect this device and reconnect; share this status if it continues.`;
}
export async function runSchedule(env,now=new Date()){
 // Pagination supports more users without silently ignoring rows beyond PostgREST's cap.
 for(let offset=0;;offset+=100){
 const settings=await db(env,`notification_settings?enabled=eq.true&select=*&order=user_id&limit=100&offset=${offset}`);
 for(const setting of settings){
  try{if(setting.mode==='never')continue;
   const plans=await db(env,`planners?user_id=eq.${setting.user_id}&select=data`);if(!plans.length)continue;
   const plan=validatePlan(plans[0].data);if(plan.timezone!==setting.timezone)continue;
   const pending=scheduledNotifications(setting,plan,now);if(!pending.length)continue;
   const subscriptions=await devices(env,setting.user_id);if(!subscriptions.length)continue;
   for(const notification of pending){
    if(!await claim(env,setting.user_id,notification.slot))continue;
    const results=await Promise.allSettled(subscriptions.map(device=>send(env,device,notification.message)));
    if(results.some(r=>r.status==='rejected'||!r.value.accepted))console.warn('Some scheduled notifications were not delivered.');
   }
  }catch{console.error('A scheduled notification could not be processed.')}
 }
 if(settings.length<100)break;
 }
 // Keep the free database small. Retain a week of deduplication records.
 if(now.getUTCHours()===0&&now.getUTCMinutes()===0)await db(env,`push_deliveries?created_at=lt.${encodeURIComponent(new Date(now.getTime()-7*86400000).toISOString())}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
}
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  // Non-secret diagnostics are readable directly; they do not test credentials or expose keys.
  if(path==='/health'&&request.method==='GET')return json(configuration(env));
  const origin=request.headers.get('Origin'),allowed=appOrigin(env.APP_ORIGIN);
  if(!allowed||origin!==allowed)return json({error:'Origin not allowed. Check APP_ORIGIN in the Worker runtime settings.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'}});
  try{
   if(path==='/public-key'&&request.method==='GET'){
    if(!/^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY||''))return json({error:'VAPID_PUBLIC_KEY is missing or invalid in Worker runtime settings. Check /health.'},503,origin);
    return json({publicKey:env.VAPID_PUBLIC_KEY},200,origin);
   }
   if(path!=='/test'||request.method!=='POST')return json({error:'Not found.'},404,origin);
   let options;try{const body=await request.text();if(body.length>1024)return json({error:'Test request is too large.'},413,origin);options=body?JSON.parse(body):{}}catch{return json({error:'Invalid test notification options.'},400,origin)}
   const mode=options?.mode||'interval';
   if(!['never','interval','before_task'].includes(mode)||mode==='interval'&&!validInterval(options?.interval_hours??1))return json({error:'Choose a notification mode and a whole interval from 1 to 24 hours.'},400,origin);
   const authorization=request.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))return json({error:'Log in first.'},401,origin);
   if(configuration(env).configuration!=='configured')return json({error:'Worker runtime settings are missing or invalid. Open the Worker /health address to see which settings need attention.'},503,origin);
   const auth=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:authorization},signal:AbortSignal.timeout(15000)});
   if(!auth.ok)return json({error:'Your login has expired. Log in again.'},401,origin);
   const user=await auth.json();
   const list=await devices(env,user.id);if(!list.length)return json({error:'Enable notifications on a device first.'},400,origin);
   if(!await vapidKeysMatch(env))return json({error:'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not match. Copy both from the same notification keys file into Worker runtime settings.'},503,origin);
   const saved=await db(env,`planners?user_id=eq.${encodeURIComponent(user.id)}&select=data`);
   const example=exampleNotification(saved.length?validatePlan(saved[0].data):emptyPlan(),mode);
   if(!await claim(env,user.id,`test:${Math.floor(Date.now()/60000)}`))return json({error:'Please wait a minute before another test.'},429,origin);
   const results=await Promise.allSettled(list.map(device=>send(env,device,example)));
   if(!results.some(r=>r.status==='fulfilled'&&r.value.accepted))return json({error:deliveryError(results)},502,origin);
   return json({sent:true,example},200,origin);
  }catch(error){
   if(error.stage==='database'){
    const message=error.status===403?'The Worker lacks database permissions. Run supabase/worker-permissions.sql in your Supabase SQL editor.':error.status===401?'Supabase rejected the backend key. Check SUPABASE_SERVICE_ROLE_KEY in Worker runtime settings.':error.status===404?'A notification database table is missing or unavailable. Run the latest supabase/schema.sql in your project.':`The notification database request failed (HTTP ${error.status}). Please retry later.`;
    return json({error:message},503,origin);
   }
   return json({error:'The Worker could not complete the notification request. Check Worker logs or retry shortly.'},503,origin);
  }
 },
 async scheduled(event,env,ctx){ctx.waitUntil(runSchedule(env,new Date(event.scheduledTime)))}
};
