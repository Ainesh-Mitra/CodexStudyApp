export function pushBaseUrl(value){
 let input=String(value||'').trim();if(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\/?$/i.test(input))input='https://'+input;
 let url;try{url=new URL(input)}catch{throw Error('PUSH_API_URL must be the full HTTPS address of your dayline-push Worker.')}
 if(url.protocol!=='https:'||url.pathname!=='/'||url.href.includes('?')||url.href.includes('#')||url.username||url.password)throw Error('PUSH_API_URL must contain only the Worker origin, like https://dayline-push.YOUR-SUBDOMAIN.workers.dev, without a path or #.');
 return url.origin;
}
export async function readPushResponse(response,path){
 const text=await response.text();let result;
 try{result=JSON.parse(text)}catch{throw Error(`Notification service returned ${text.trim()?'a non-JSON':'an empty'} response (HTTP ${response.status}). Check that PUSH_API_URL is the dayline-push Worker address, then redeploy the website.`)}
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('The notification service returned an invalid response. Check PUSH_API_URL and the Worker deployment.');
 if(!response.ok)throw Error(typeof result.error==='string'?result.error:`Notification service failed (HTTP ${response.status}).`);
 if(path==='/public-key'&&!/^[A-Za-z0-9_-]{87}$/.test(result.publicKey||''))throw Error('The Worker did not return a valid notification public key. Check VAPID_PUBLIC_KEY in dayline-push settings and deploy the Worker.');
 if(path==='/test'&&result.sent!==true)throw Error('The Worker did not confirm sending the test. Check PUSH_API_URL and the Worker deployment.');
 return result;
}
