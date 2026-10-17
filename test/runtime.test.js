import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import webpush from 'web-push';
import {Miniflare,convertV4MiniflareOptions,Response as RuntimeResponse} from 'miniflare';

test('Cloudflare runtime sends an encrypted test push and does not follow redirects',async()=>{
 const vapid=webpush.generateVAPIDKeys(),recipient=webpush.generateVAPIDKeys();
 const bundle=await build({entryPoints:['worker/index.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 let pushStatus=201,pushCalls=0,unexpected=[];
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-01',script:bundle.outputFiles[0].text,
 bindings:{APP_ORIGIN:'https://planner.test',SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'test-backend',VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:'mailto:test@example.com'},
 outboundService:async request=>{
  const url=new URL(request.url);
  if(url.hostname==='fcm.googleapis.com'){
   pushCalls++;assert.equal(request.method,'POST');assert.equal(request.headers.get('content-encoding'),'aes128gcm');assert.match(request.headers.get('authorization'),/^vapid /);assert.ok((await request.arrayBuffer()).byteLength>0);
   return new RuntimeResponse(null,{status:pushStatus,...(pushStatus===302?{headers:{Location:'https://untrusted.test/stolen'}}:{})});
  }
  if(url.hostname==='database.test'){
   if(url.pathname==='/auth/v1/user')return RuntimeResponse.json({id:'alice'});
   if(url.pathname==='/rest/v1/planners')return RuntimeResponse.json([]);
   if(url.pathname==='/rest/v1/push_subscriptions')return RuntimeResponse.json([{id:'device',endpoint:'https://fcm.googleapis.com/fcm/send/test-device',subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:recipient.publicKey,auth:Buffer.alloc(16,1).toString('base64url')}}}]);
   if(url.pathname==='/rest/v1/push_deliveries')return new RuntimeResponse(null,{status:201});
  }
  unexpected.push(request.url);return new RuntimeResponse(null,{status:500});
 }
 }));
 try{
  const request=()=>runtime.dispatchFetch('https://push.test/test',{method:'POST',headers:{Origin:'https://planner.test',Authorization:'Bearer test-user'}});
  let response=await request();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).sent,true);assert.equal(pushCalls,1);
  pushStatus=302;response=await request();assert.equal(response.status,502);assert.match((await response.json()).error,/redirected/);assert.equal(pushCalls,2);assert.deepEqual(unexpected,[]);
 }finally{await runtime.dispose()}
});
