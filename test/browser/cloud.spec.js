import {test,expect} from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';
const user={id,email:'alice@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})).toString('base64url')}.signature`;
test('login keeps guest data separate, saves privately and reports stale cloud edits',async({page})=>{
 let remote=null,revision=0,conflict=false,requests=[],notificationSettings=null;
 await page.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:`window.DAYLINE_CONFIG=${JSON.stringify({supabaseUrl:'https://test.supabase.co',supabaseKey:'test-public-key',pushUrl:'https://push.example.test'})}`}));
 await page.route('https://test.supabase.co/**',async route=>{const req=route.request(),url=new URL(req.url());requests.push(url.pathname);
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
 if(url.pathname==='/auth/v1/token')return route.fulfill({headers,json:{access_token:token(),refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user}});
 if(url.pathname==='/auth/v1/logout')return route.fulfill({headers,json:{}});
 if(url.pathname==='/rest/v1/planners')return route.fulfill({headers,json:remote?{data:remote,revision}:null});
 if(url.pathname==='/rest/v1/rpc/save_planner'){const body=req.postDataJSON();if(conflict||body.expected_revision!==revision)return route.fulfill({status:409,headers,json:{code:'P0001',message:'revision_conflict'}});remote=body.payload;revision++;return route.fulfill({headers,json:revision})}
 if(url.pathname==='/rest/v1/notification_settings'){if(req.method()==='POST')notificationSettings=req.postDataJSON();return route.fulfill(req.method()==='GET'?{headers,json:notificationSettings}:{status:204,headers})}
 return route.fulfill({status:404,headers,json:{message:'Unexpected test request'}});
 });
 await page.goto('/');await page.locator('.subject').first().click();await page.evaluate(()=>{const day=document.querySelector('.day');day.dispatchEvent(new MouseEvent('click',{clientY:day.getBoundingClientRect().top+800,bubbles:true}))});await page.locator('#task-title').fill('Guest-only task');await page.locator('#schedule-task').click();
 await page.locator('#login-button').click();await page.locator('#email').fill(user.email);await page.locator('#password').fill('long-password');await page.locator('#auth-form').getByRole('button',{name:'Log in',exact:true}).click();await expect(page.locator('#login-button')).toHaveText('Log out');await expect(page.locator('#save-status')).toHaveText('Saved to your account');await expect(page.locator('.event')).toHaveCount(0);expect(remote.tasks).toEqual([]);
 await page.locator('.subject').first().click();await page.evaluate(()=>{const day=document.querySelector('.day');day.dispatchEvent(new MouseEvent('click',{clientY:day.getBoundingClientRect().top+800,bubbles:true}))});await page.locator('#task-title').fill('Account task');await page.locator('#schedule-task').click();await expect(page.locator('#save-status')).toHaveText('Saved to your account');expect(remote.tasks[0].title).toBe('Account task');
 let emptyPush=true,testOptions=null;
 await page.route('https://push.example.test/**',route=>{testOptions=route.request().postDataJSON();return route.fulfill({status:emptyPush?204:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'},...(emptyPush?{}:{body:JSON.stringify({sent:true,example:{title:testOptions.mode==='before_task'?'Example · Starting in 15 minutes':'Example · Notifications off',body:'A sample task'}})})})});
 await page.locator('#notifications-button').click();await page.locator('#test-push').click();await expect(page.locator('#push-status')).toContainText('empty response (HTTP 204)');
 await page.locator('input[name="notification-mode"][value="interval"]').check();await page.locator('#interval-hours').fill('0');await page.locator('#save-notifications').click();await expect(page.locator('#push-status')).toContainText('whole number');expect(notificationSettings).toBeNull();
 await page.locator('#interval-hours').fill('2');await page.locator('#save-notifications').click();await expect(page.locator('#push-status')).toContainText('every 2 hours');expect(notificationSettings.mode).toBe('interval');expect(notificationSettings.interval_hours).toBe(2);expect(notificationSettings.enabled).toBe(true);
 await page.locator('#notifications-dialog').getByRole('button',{name:'Close',exact:true}).click();await page.locator('#notifications-button').click();await expect(page.locator('#interval-hours')).toHaveValue('2');
 await page.locator('input[name="notification-mode"][value="before_task"]').check();await expect(page.locator('#interval-hours')).toBeDisabled();await page.locator('#save-notifications').click();expect(notificationSettings.mode).toBe('before_task');
 await page.locator('input[name="notification-mode"][value="never"]').check();await page.locator('#save-notifications').click();await expect(page.locator('#push-status')).toContainText('Automatic notifications are off');expect(notificationSettings.enabled).toBe(false);
 emptyPush=false;await page.locator('input[name="notification-mode"][value="before_task"]').check();await page.locator('#test-push').click();await expect(page.locator('#push-status')).toContainText('Test sent');expect(testOptions.mode).toBe('before_task');expect(notificationSettings.mode).toBe('never');await expect(page.locator('#preview-title')).toHaveText('Example · Starting in 15 minutes');await expect(page.locator('#preview-body')).toHaveText('A sample task');await page.locator('#notifications-dialog').getByRole('button',{name:'Close',exact:true}).click();
 conflict=true;await page.locator('.event-content').click();await expect(page.locator('#save-status')).toContainText('Another device saved');expect(remote.tasks[0].completedOn).toBeNull();await page.locator('#retry-save').click();await expect(page.locator('#reload-cloud')).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.locator('#reload-cloud').click();await expect(page.locator('.event')).not.toHaveClass(/completed/);await expect(page.locator('#save-status')).toHaveText('Saved to your account');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#login-button').click();await expect(page.locator('#login-button')).toHaveText('Log in');await expect(page.locator('.event-name')).toHaveText('Guest-only task');expect(requests).toContain('/rest/v1/rpc/save_planner');
});

test('two independent devices sync additions and completions while both stay open',async({browser})=>{
 test.setTimeout(45000);
 let remote=null,revision=0,failProbes=false;
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'};
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 try{
  const pages=[];
  for(const context of contexts){
   await context.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:`window.DAYLINE_CONFIG=${JSON.stringify({supabaseUrl:'https://test.supabase.co',supabaseKey:'test-public-key',pushUrl:'https://push.example.test'})}`}));
   await context.route('https://test.supabase.co/**',route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname==='/auth/v1/token')return route.fulfill({headers,json:{access_token:token(),refresh_token:'refresh',expires_in:3600,token_type:'bearer',user}});
    if(url.pathname==='/rest/v1/planners'){if(failProbes&&url.searchParams.get('select')==='revision')return route.fulfill({status:503,headers,json:{message:'Temporary network failure'}});expect(url.searchParams.get('user_id')).toBe(`eq.${id}`);return route.fulfill({headers,json:remote?(url.searchParams.get('select')==='revision'?{revision}:{data:remote,revision}):null})}
    if(url.pathname==='/rest/v1/rpc/save_planner'){
     const payload=request.postDataJSON();if(payload.expected_revision!==revision)return route.fulfill({status:409,headers,json:{code:'P0001',message:'revision_conflict'}});
     remote=payload.payload;revision++;return route.fulfill({headers,json:revision});
    }
    if(url.pathname==='/rest/v1/notification_settings')return route.fulfill({status:204,headers});
    return route.fulfill({status:404,headers,json:{message:'Unexpected test request'}});
   });
   const page=await context.newPage();pages.push(page);await page.goto('/');await page.locator('#login-button').click();await page.locator('#email').fill(user.email);await page.locator('#password').fill('long-password');await page.locator('#auth-form').getByRole('button',{name:'Log in',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved to your account');
  }
  const [computer,phone]=pages;
  await computer.locator('.subject').first().click();await computer.evaluate(()=>{const day=document.querySelector('.day');day.dispatchEvent(new MouseEvent('click',{clientY:day.getBoundingClientRect().top+800,bubbles:true}))});await computer.locator('#task-title').fill('Shared account task');await computer.locator('#schedule-task').click();await expect(computer.locator('#save-status')).toHaveText('Saved to your account');
  await expect(phone.locator('.event-name')).toHaveText('Shared account task',{timeout:12000});
  await phone.locator('.event-content').click();await expect(phone.locator('#save-status')).toHaveText('Saved to your account');await expect(computer.locator('.event')).toHaveClass(/completed/,{timeout:12000});
  // A pending title prompt holds its day DOM node; syncing must not replace it.
  await computer.locator('.subject').first().click();await computer.evaluate(()=>{const day=document.querySelector('.day');day.dispatchEvent(new MouseEvent('click',{clientY:day.getBoundingClientRect().top+900,bubbles:true}))});await expect(computer.locator('#task-dialog')).toBeVisible();
  await phone.locator('.event-content').click();await expect(phone.locator('#save-status')).toHaveText('Saved to your account');await computer.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(computer.locator('.event')).toHaveClass(/completed/);
  await computer.locator('#task-cancel').click();await expect(computer.locator('.event')).not.toHaveClass(/completed/,{timeout:12000});
  failProbes=true;await expect(computer.locator('#save-status')).toContainText('Sync unavailable',{timeout:12000});await expect(computer.locator('.event-name')).toHaveText('Shared account task');failProbes=false;await expect(computer.locator('#save-status')).toHaveText('Saved to your account',{timeout:12000});
 }finally{await Promise.all(contexts.map(context=>context.close()))}
});
