import { validInterval, REMINDER_MINUTES } from './notifications.js';
import { pushBaseUrl, readPushResponse } from './push-client.js';
import { createClient } from '@supabase/supabase-js';
import { dateParts, validatePlan, emptyPlan } from './model.js';

const names=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const grid=document.querySelector('.grid-body'), heads=document.querySelector('.day-heads'), times=document.querySelector('.times'), tray=document.querySelector('.subjects'), add=document.querySelector('.add'), dialog=document.querySelector('dialog');
const config=window.DAYLINE_CONFIG||{};
let plan=emptyPlan(),user=null,revision=0,hydrating=true,dirty=false,saveTimer=null,saving=false,conflict=false,accountLoad=0,loadingOwner=undefined;
let cloud=null;try{if(config.supabaseUrl&&config.supabaseKey)cloud=createClient(config.supabaseUrl,config.supabaseKey)}catch{console.warn('Invalid cloud configuration. Using local planner.');}
const subjects=[];let selected=null;let statusTimer;let pendingTask=null;
const taskDialog=document.querySelector('#task-dialog'),taskInput=document.querySelector('#task-title');
function localDay(date=new Date()){return dateParts(date,plan.timezone).date}
function resetExpiredCompletions(){
 const date=localDay();
 document.querySelectorAll('.event.completed').forEach(block=>{
  if(block.dataset.completedOn===date)return;
  block.classList.remove('completed');delete block.dataset.completedOn;
  block.querySelector('.event-content').setAttribute('aria-pressed','false');
 });
 const currentDay=dateParts(new Date(),plan.timezone).weekday;
 const local=dateParts(new Date(),plan.timezone),[year,month,dayOfMonth]=local.date.split('-').map(Number),monday=new Date(Date.UTC(year,month-1,dayOfMonth-currentDay));
 document.querySelectorAll('.day-head').forEach((head,index)=>{head.classList.toggle('today',index===currentDay);const dayDate=new Date(monday.getTime()+index*86400000);head.querySelector('strong').textContent=dayDate.getUTCDate()});
 document.querySelector('#week-label').textContent='Repeats every week';
}
function scheduleDailyReset(){
 const now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
 setTimeout(()=>{resetExpiredCompletions();scheduleDailyReset()},Math.min(midnight.getTime()-now.getTime()+50,30000));
}
scheduleDailyReset();
// Recheck after sleeping/backgrounding, and after device clock or timezone changes.
setInterval(resetExpiredCompletions,30000);
window.addEventListener('focus',resetExpiredCompletions);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resetExpiredCompletions()});
const today=dateParts(new Date(),plan.timezone).weekday;
function announce(message){const status=document.querySelector('.status');status.textContent=message;clearTimeout(statusTimer);statusTimer=setTimeout(()=>status.textContent='',3500)}
function timeLabel(slot){if(slot===96)return '12:00 AM (next day)';const hour=Math.floor(slot/4),minute=slot%4*15;return `${hour%12||12}:${String(minute).padStart(2,'0')} ${hour<12?'AM':'PM'}`}
for(let hour=0;hour<24;hour++){const label=document.createElement('span');label.className='time';label.style.top=`${hour*88+3}px`;label.textContent=`${hour%12||12} ${hour<12?'AM':'PM'}`;times.append(label)}
names.forEach((name,index)=>{const head=document.createElement('div');head.className='day-head'+(index===today?' today':'');head.textContent=name;const number=document.createElement('strong');number.textContent=['M','T','W','T','F','S','S'][index];head.append(number);heads.append(head);const day=document.createElement('div');day.className='day';day.dataset.day=index;day.setAttribute('aria-label',name);day.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';day.classList.add('over')});day.addEventListener('dragleave',()=>day.classList.remove('over'));day.addEventListener('drop',e=>{e.preventDefault();day.classList.remove('over');const subject=subjects.find(s=>s.id===e.dataTransfer.getData('text/plain'));if(subject)requestTask(day,subject,slotAt(day,e.clientY))});day.addEventListener('click',e=>{if(e.target!==day)return;if(selected)requestTask(day,selected,slotAt(day,e.clientY));else announce('Select a subject in the tray first.')});grid.append(day)});
function slotAt(day,y){return Math.max(0,Math.min(95,Math.floor((y-day.getBoundingClientRect().top)/22)))}
function choose(subject){selected=subject;document.querySelectorAll('.subject').forEach(el=>{const active=el.dataset.id===subject.id;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active))})}
function newSubject(name,color){const subject={id:crypto.randomUUID(),name,color};subjects.push(subject);const tile=document.createElement('button');tile.type='button';tile.className='subject';tile.draggable=true;tile.dataset.id=subject.id;tile.style.setProperty('--color',color);tile.style.setProperty('--tint',color+'25');tile.setAttribute('aria-pressed','false');const grip=document.createElement('span');grip.className='grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=name;tile.append(grip,text);tile.addEventListener('click',()=>{choose(subject);announce(`${name} selected. Click a calendar slot to place it.`)});tile.addEventListener('dragstart',e=>{choose(subject);e.dataTransfer.setData('text/plain',subject.id);e.dataTransfer.effectAllowed='copy'});tray.insertBefore(tile,add);return subject}
function occupied(day,start,end,except){return [...day.querySelectorAll('.event')].some(block=>block!==except&&start<Number(block.dataset.end)&&end>Number(block.dataset.slot))}
function requestTask(day,subject,slot){
 if(hydrating){announce('Loading your planner…');return}if(grid.querySelectorAll('.event').length>=672){announce('Your weekly planner is full.');return}
 if(occupied(day,slot,slot+1)){announce('That time is already occupied. Choose an empty slot.');return}
 pendingTask={day,subject,slot};taskInput.value='';taskInput.setCustomValidity('');document.querySelector('#task-error').hidden=true;
 document.querySelector('#task-context').textContent=`${subject.name} · ${names[Number(day.dataset.day)]} · ${timeLabel(slot)}`;
 taskDialog.showModal();taskInput.focus();
}
function cancelTask(){pendingTask=null;taskDialog.close()}
document.querySelector('#task-cancel').addEventListener('click',cancelTask);
taskDialog.addEventListener('cancel',()=>pendingTask=null);
taskInput.addEventListener('input',()=>{taskInput.setCustomValidity('');document.querySelector('#task-error').hidden=true});
function scheduleTask(e){
 e.preventDefault();
 const error=document.querySelector('#task-error'),name=taskInput.value.trim();
 function showError(message){error.textContent=message;error.hidden=false;taskInput.focus()}
 if(!name){showError('Please enter a title for your task.');return}
 if(!pendingTask){showError('Please cancel and select a calendar slot again.');return}
 const {day,subject,slot}=pendingTask;
 if(occupied(day,slot,slot+1)){showError('That time is now occupied. Cancel and choose another slot.');return}
 const block=place(day,subject,slot,name);changed();
 pendingTask=null;taskDialog.close();block.scrollIntoView({block:'nearest',inline:'nearest'});
}
document.querySelector('#schedule-task').addEventListener('click',scheduleTask);
document.querySelector('#task-form').addEventListener('submit',scheduleTask);
function place(day,subject,slot,taskTitle,saved=null){
 if(occupied(day,slot,slot+1)){announce('That time is already occupied. Choose an empty slot.');return}
 const block=document.createElement('div');block.className='event';block.dataset.slot=slot;block.dataset.end=saved?.end||slot+1;block.dataset.id=saved?.id||crypto.randomUUID();block.dataset.subject=subject.id;block.dataset.title=taskTitle;if(saved?.completedOn===localDay()){block.dataset.completedOn=saved.completedOn;block.classList.add('completed')}
 block.style.setProperty('--color',subject.color);block.style.setProperty('--tint',subject.color+'30');
 const content=document.createElement('button');content.type='button';content.className='event-content';
 const title=document.createElement('strong');title.className='event-name';title.textContent=taskTitle;
 const range=document.createElement('span');range.className='event-range';const subjectLabel=document.createElement('span');subjectLabel.className='event-subject';subjectLabel.textContent=subject.name;content.append(title,subjectLabel,range);block.append(content);
 function render(){const start=Number(block.dataset.slot),end=Number(block.dataset.end);block.style.top=`${start*22+1}px`;block.style.height=`${(end-start)*22-1}px`;block.classList.toggle('short',end-start===1);range.textContent=`${timeLabel(start)} – ${timeLabel(end)}`;block.title=`${taskTitle} · ${subject.name} · ${names[Number(day.dataset.day)]} · ${range.textContent}`;content.setAttribute('aria-label',`${block.title}. Drag to move; click to mark complete or undo; Ctrl + click to delete.`);block.querySelectorAll('.resize-handle').forEach(handle=>{const top=handle.dataset.edge==='top';handle.setAttribute('aria-valuemin',String(top?0:start+1));handle.setAttribute('aria-valuemax',String(top?end-1:96));handle.setAttribute('aria-valuenow',String(top?start:end));handle.setAttribute('aria-valuetext',timeLabel(top?start:end))})}
 function resize(edge,value){let start=Number(block.dataset.slot),end=Number(block.dataset.end);if(edge==='top')start=Math.max(0,Math.min(end-1,value));else end=Math.min(96,Math.max(start+1,value));if(occupied(day,start,end,block))return false;block.dataset.slot=start;block.dataset.end=end;render();return true}
 let suppressClick=false;
 content.setAttribute('aria-pressed',String(block.classList.contains('completed')));
 content.addEventListener('click',e=>{
  e.stopPropagation();if(suppressClick){suppressClick=false;return}
  resetExpiredCompletions();
  if(e.ctrlKey){block.remove();changed();announce('Block deleted.');return}
  const completed=block.classList.toggle('completed');
  content.setAttribute('aria-pressed',String(completed));
  if(completed)block.dataset.completedOn=localDay();else delete block.dataset.completedOn;
  changed();announce(completed?`${taskTitle} marked complete.`:`${taskTitle} marked incomplete.`);
 });
 content.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;e.stopPropagation();suppressClick=false;
  const pointer=e.pointerId,originDay=day,originStart=Number(block.dataset.slot),originEnd=Number(block.dataset.end),duration=originEnd-originStart;
  const startX=e.clientX,startY=e.clientY,offset=(startY-originDay.getBoundingClientRect().top)/22-originStart;
  let moved=false,valid=true;
  // Capture on a stable parent so crossing day columns cannot lose the gesture.
  function restore(){day=originDay;day.append(block);block.dataset.slot=originStart;block.dataset.end=originEnd;render()}
  const move=event=>{
   if(event.pointerId!==pointer)return;
   if(!moved&&Math.hypot(event.clientX-startX,event.clientY-startY)<5)return;
   event.preventDefault();if(!moved)grid.setPointerCapture(pointer);moved=true;suppressClick=true;block.classList.add('moving');
   const scroller=document.querySelector('.calendar-scroll'),viewport=scroller.getBoundingClientRect();
   const headerHeight=heads.getBoundingClientRect().height;
   if(event.clientX<viewport.left||event.clientX>viewport.right||event.clientY<viewport.top+headerHeight||event.clientY>viewport.bottom){valid=false;return}
   if(event.clientY>viewport.bottom-30)scroller.scrollTop+=12;
   else if(event.clientY<viewport.top+headerHeight+30)scroller.scrollTop-=12;
   const target=[...grid.querySelectorAll('.day')].find(column=>{const rect=column.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<rect.right});
   if(!target){valid=false;return}
   const start=Math.max(0,Math.min(96-duration,Math.round((event.clientY-target.getBoundingClientRect().top)/22-offset)));
   if(occupied(target,start,start+duration,block)){valid=false;return}
   valid=true;day=target;day.append(block);block.dataset.slot=start;block.dataset.end=start+duration;render();
  };
  const finish=event=>{
   if(event.pointerId!==pointer)return;
   document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);grid.removeEventListener('lostpointercapture',finish);
   block.classList.remove('moving');
   if(moved){if(!valid||event.type==='pointercancel'){restore();announce('Move canceled. Choose an empty time range.')}else {changed();announce(`Moved: ${block.title}`)}}
   if(grid.hasPointerCapture(pointer))grid.releasePointerCapture(pointer);
  };
  document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);grid.addEventListener('lostpointercapture',finish);
 });
 for(const edge of ['top','bottom']){
  const handle=document.createElement('span');handle.className=`resize-handle ${edge}`;handle.dataset.edge=edge;handle.tabIndex=0;handle.setAttribute('role','slider');handle.setAttribute('aria-label',`${taskTitle} ${edge==='top'?'start':'end'} time`);handle.setAttribute('aria-orientation','vertical');
  handle.addEventListener('click',e=>e.stopPropagation());
  handle.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const current=Number(block.dataset[edge==='top'?'slot':'end']);resize(edge,current+(e.key==='ArrowUp'?-1:1));changed();announce(block.title)});
  handle.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);
   const pointer=e.pointerId,initialY=e.clientY,initialStart=Number(block.dataset.slot),initialEnd=Number(block.dataset.end),initialBoundary=edge==='top'?initialStart:initialEnd;
   block.classList.add('resizing');
   const move=event=>{if(event.pointerId!==pointer)return;event.preventDefault();resize(edge,initialBoundary+Math.round((event.clientY-initialY)/22))};
   const finish=event=>{if(event.pointerId!==pointer)return;if(event.type==='pointercancel'){block.dataset.slot=initialStart;block.dataset.end=initialEnd;render()}block.classList.remove('resizing');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);handle.removeEventListener('lostpointercapture',finish);if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);if(event.type!=='pointercancel')changed();announce(block.title)};
   handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  });block.append(handle);
 }
 day.append(block);render();announce(`${taskTitle} (${subject.name}) scheduled for ${names[Number(day.dataset.day)]}, ${timeLabel(slot)}. Drag its edges to change the time range.`);return block
}

document.querySelector('.toggle').addEventListener('click',e=>{const hidden=document.body.classList.toggle('tray-hidden');document.querySelector('#tray').inert=hidden;e.currentTarget.textContent=hidden?'⌃':'⌄';e.currentTarget.setAttribute('aria-expanded',String(!hidden));e.currentTarget.setAttribute('aria-label',hidden?'Show subjects':'Hide subjects')});
add.addEventListener('click',()=>{dialog.showModal();document.querySelector('#subject-name').focus()});document.querySelector('#cancel').addEventListener('click',()=>dialog.close());document.querySelector('#subject-form').addEventListener('submit',e=>{e.preventDefault();const input=document.querySelector('#subject-name'),name=input.value.trim();if(!name){input.setCustomValidity('Enter a subject name.');input.reportValidity();return}if(subjects.length>=100){announce('You can have up to 100 subjects.');return}const subject=newSubject(name,document.querySelector('#subject-color').value);choose(subject);changed();dialog.close();input.value='';add.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});announce(`${name} added. Drag it onto your week.`)});document.querySelector('#subject-name').addEventListener('input',e=>e.target.setCustomValidity(''));
document.querySelector('.calendar-scroll').scrollTop=8*88;

function cacheKey(){return `dayline:${user?.id||'guest'}`}
function snapshot(){return {version:1,timezone:plan.timezone,subjects:subjects.map(s=>({...s})),tasks:[...grid.querySelectorAll('.event')].map(el=>({id:el.dataset.id,subjectId:el.dataset.subject,title:el.dataset.title,day:Number(el.parentElement.dataset.day),start:Number(el.dataset.slot),end:Number(el.dataset.end),completedOn:el.dataset.completedOn||null}))}}
function saveStatus(message,error=false){const el=document.querySelector('#save-status');el.textContent=message;el.classList.toggle('error',error);document.querySelector('#retry-save').hidden=!(dirty&&user)}
function cache(){try{localStorage.setItem(cacheKey(),JSON.stringify({plan,revision,dirty}));return true}catch{saveStatus('Storage is full or unavailable. Download a backup before closing.',true);return false}}
function changed(){if(hydrating)return;plan=validatePlan(snapshot());dirty=!!user;const cached=cache();if(!user){if(cached)saveStatus('Saved on this device');return}saveStatus('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(syncSave,500)}
async function syncSave(){
 if(!user||!cloud||!dirty||saving||conflict)return;
 saving=true;const owner=user.id,sent=structuredClone(plan),expected=revision;
 try{
  const {data,error}=await cloud.rpc('save_planner',{payload:sent,expected_revision:expected});if(error)throw error;
  if(user?.id!==owner)return;
  revision=data;await cloud.from('notification_settings').update({timezone:sent.timezone}).eq('user_id',owner);if(user?.id!==owner)return;dirty=JSON.stringify(plan)!==JSON.stringify(sent);cache();saveStatus(dirty?'Saving…':'Saved to your account');
 }catch(error){if(user?.id===owner){conflict=error.message?.includes('revision_conflict');saveStatus(conflict?'Another device saved changes. Open settings to reload.':'Saved locally · Cloud save failed. Retry when online.',true)}}
 finally{saving=false;if(dirty&&!conflict&&user?.id===owner&&revision!==expected)saveTimer=setTimeout(syncSave,500)}
}
function renderPlan(value){
 validatePlan(value);
 hydrating=true;plan=validatePlan(value);selected=null;subjects.splice(0);tray.querySelectorAll('.subject').forEach(el=>el.remove());grid.querySelectorAll('.event').forEach(el=>el.remove());
 for(const s of plan.subjects){const created=newSubject(s.name,s.color);const oldId=created.id;created.id=s.id;tray.querySelector(`[data-id="${oldId}"]`).dataset.id=s.id}
 for(const task of plan.tasks){const subject=subjects.find(s=>s.id===task.subjectId);place(grid.querySelectorAll('.day')[task.day],subject,task.start,task.title,task)}
 resetExpiredCompletions();document.querySelector('.status').textContent='';hydrating=false;document.querySelector('main').inert=false;
}
function readCache(){try{const saved=JSON.parse(localStorage.getItem(cacheKey()));if(saved){validatePlan(saved.plan);return saved}}catch{}return null}
async function loadAccount(nextUser){
 if(user?.id===nextUser?.id&&!hydrating)return;if(loadingOwner===(nextUser?.id||'guest'))return;const sequence=++accountLoad;loadingOwner=nextUser?.id||'guest';
 clearTimeout(saveTimer);hydrating=true;document.querySelector('main').inert=true;user=nextUser;conflict=false;dirty=false;revision=0;
 document.querySelector('#login-button').textContent=user?'Log out':'Log in';document.querySelector('#account-status').textContent=user?`Private account · ${user.email}`:'Local planner · Log in to sync across devices';
 const local=readCache();
 if(!user){renderPlan(local?.plan||emptyPlan());saveStatus('Saved on this device');loadingOwner=undefined;return}
 saveStatus('Loading private planner…');
 try{const {data,error}=await cloud.from('planners').select('data,revision').eq('user_id',user.id).maybeSingle();if(error)throw error;if(sequence!==accountLoad)return;
  if(local?.dirty){revision=local.revision;dirty=true;renderPlan(local.plan);if(data&&data.revision!==revision){conflict=true;saveStatus('Unsynced local edits conflict with another save. Open settings.',true)}else{saveStatus('Saving local edits…');syncSave()}}
  else if(data){revision=data.revision;renderPlan(data.data);cache();saveStatus('Saved to your account')}
  else{renderPlan(local?.plan||emptyPlan());changed()}
 }catch{if(sequence!==accountLoad)return;renderPlan(local?.plan||emptyPlan());revision=local?.revision||0;dirty=!!local?.dirty;saveStatus('Cloud unavailable · Your local copy is open',true)}finally{if(sequence===accountLoad)loadingOwner=undefined}
}
async function refreshCloud(){if(!cloud||!user||hydrating||dirty||saving)return;const owner=user.id;const {data,error}=await cloud.from('planners').select('data,revision').eq('user_id',owner).maybeSingle();if(!error&&data&&user?.id===owner&&!dirty&&data.revision>revision){revision=data.revision;renderPlan(data.data);cache();saveStatus('Updated from your account')}}
window.addEventListener('online',()=>dirty?syncSave():refreshCloud());window.addEventListener('focus',refreshCloud);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCloud()});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
document.querySelector('#retry-save').addEventListener('click',()=>{if(conflict){document.querySelector('#settings-dialog').showModal();return}syncSave()});
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>document.getElementById(button.dataset.close).close());
document.querySelector('#login-button').addEventListener('click',async()=>{
 if(!cloud){announce('Cloud login needs hosting configuration. Your local planner still saves on this device.');return}
 if(user){if(dirty){announce('Please sync your changes before logging out.');return}if(!confirm('Log out of your private planner?'))return;try{await disconnectDevice(false);const {error}=await cloud.auth.signOut();if(error)throw error;await loadAccount(null)}catch{announce('Could not log out. Please retry online.')}return}
 document.querySelector('#auth-dialog').showModal();
});
async function authenticate(signup){
 const form=document.querySelector('#auth-form');if(!form.reportValidity())return;
 const message=document.querySelector('#auth-message');message.textContent=signup?'Creating account…':'Logging in…';
 form.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{const credentials={email:document.querySelector('#email').value.trim(),password:document.querySelector('#password').value};
 const {data,error}=signup?await cloud.auth.signUp({...credentials,options:{emailRedirectTo:location.origin}}):await cloud.auth.signInWithPassword(credentials);if(error)throw error;
 if(data.session){document.querySelector('#auth-dialog').close();document.querySelector('#password').value='';await loadAccount(data.user)}else message.textContent='Check your email to confirm your account, then log in here.';
 }catch(error){message.textContent=error.message||'Could not authenticate. Please retry.'}finally{form.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
document.querySelector('#google-login').addEventListener('click',async()=>{const {error}=await cloud.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin}});if(error)document.querySelector('#auth-message').textContent=error.message});
document.querySelector('#forgot-password').addEventListener('click',async()=>{const email=document.querySelector('#email');if(!email.reportValidity())return;const {error}=await cloud.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:location.origin});document.querySelector('#auth-message').textContent=error?.message||'If this email has an account, a reset link will arrive shortly.'});
document.querySelector('#recovery-form').addEventListener('submit',async e=>{e.preventDefault();const {error}=await cloud.auth.updateUser({password:document.querySelector('#new-password').value});if(error)document.querySelector('#recovery-message').textContent=error.message;else{document.querySelector('#recovery-dialog').close();document.querySelector('#new-password').value='';announce('Password updated.')}});
document.querySelector('#export-plan').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='dayline-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
document.querySelector('#auth-form').addEventListener('submit',e=>{e.preventDefault();authenticate(false)});document.querySelector('#signup-button').addEventListener('click',()=>authenticate(true));
const timezoneSelect=document.querySelector('#timezone');
for(const zone of [...new Set(['UTC',plan.timezone,...Intl.supportedValuesOf('timeZone')])]){const option=document.createElement('option');option.value=zone;option.textContent=zone.replaceAll('_',' ');timezoneSelect.append(option)}
document.querySelector('#settings-button').addEventListener('click',()=>{timezoneSelect.value=plan.timezone;document.querySelector('#import-local').hidden=!user;document.querySelector('#reload-cloud').hidden=!user;document.querySelector('#settings-dialog').showModal()});
document.querySelector('#save-timezone').addEventListener('click',async()=>{
 const timezone=timezoneSelect.value;
 if(user&&cloud){const {error}=await cloud.from('notification_settings').update({timezone}).eq('user_id',user.id);if(error){announce('Could not update notification time zone. Please retry online.');return}}
 plan.timezone=timezone;resetExpiredCompletions();changed();document.querySelector('#settings-dialog').close();announce('Time zone saved.');
});
document.querySelector('#import-local').addEventListener('click',()=>{if(!user)return;if(conflict){announce('Reload the cloud save first to resolve conflicting edits.');return}let guest;try{guest=JSON.parse(localStorage.getItem('dayline:guest'))}catch{}if(!guest){announce('There is no local guest plan to copy.');return}if(confirm('Replace your account’s weekly plan with the local plan on this device?')){renderPlan(validatePlan(guest.plan));changed();document.querySelector('#settings-dialog').close()}});
document.querySelector('#reload-cloud').addEventListener('click',async()=>{if(!user||!confirm('Discard unsynced local edits and load your latest cloud save?'))return;const {data,error}=await cloud.from('planners').select('data,revision').eq('user_id',user.id).maybeSingle();if(error||!data){announce('Could not load cloud save. Your local edits are unchanged.');return}revision=data.revision;conflict=false;dirty=false;renderPlan(data.data);cache();saveStatus('Saved to your account');document.querySelector('#settings-dialog').close()});

let registration=null;
if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register('/sw.js').then(r=>registration=r).catch(()=>{});
function requireCloud(){if(!cloud||!user)throw Error('Log in to connect notifications to your private schedule.');if(!config.pushUrl)throw Error('Push delivery has not been configured for this deployment.');}
async function pushRequest(path,options={}){
 requireCloud();const base=pushBaseUrl(config.pushUrl);
 const {data:{session},error}=await cloud.auth.getSession();
 if(error||!session?.access_token)throw Error('Your login has expired. Log out and log in again.');
 let response;try{response=await fetch(base+path,{...options,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)})}
 catch{throw Error('Could not reach the notification Worker. Check PUSH_API_URL and make sure APP_ORIGIN matches this website exactly.');}
 return readPushResponse(response,path);
}
function pushStatus(message){document.querySelector('#push-status').textContent=message}
let loadedNotificationSettings=null;
function notificationMode(){return document.querySelector('input[name="notification-mode"]:checked').value}
function updateNotificationControls(){
 const mode=notificationMode();document.querySelector('#interval-hours').disabled=mode!=='interval';
 document.querySelector('#notification-timing').textContent=mode==='never'?'Automatic notifications are off. Test notifications can still be sent.':mode==='interval'?'Daily progress summaries repeat at this interval, starting after you save. Choose 1–24 whole hours.':`A reminder is scheduled ${REMINDER_MINUTES} minutes before each unfinished item, using `+plan.timezone+'. Phone delivery can be delayed.';
}
for(const radio of document.querySelectorAll('input[name="notification-mode"]'))radio.addEventListener('change',updateNotificationControls);
document.querySelector('#notifications-button').addEventListener('click',async()=>{
 document.querySelector('#notifications-dialog').showModal();document.querySelector('#notification-preview').hidden=true;document.querySelector('input[name="notification-mode"][value="never"]').checked=true;document.querySelector('#interval-hours').value='1';loadedNotificationSettings=null;updateNotificationControls();document.querySelector('#save-notifications').disabled=true;
 try{requireCloud();const {data,error}=await cloud.from('notification_settings').select('*').eq('user_id',user.id).maybeSingle();if(error)throw error;
  loadedNotificationSettings=data;const mode=data?.enabled?(data.mode||'interval'):'never';document.querySelector(`input[name="notification-mode"][value="${['never','interval','before_task'].includes(mode)?mode:'never'}"]`).checked=true;document.querySelector('#interval-hours').value=data?.interval_hours||1;updateNotificationControls();pushStatus('Settings use '+plan.timezone+'. Connect each device you want to notify.');
 }catch(error){pushStatus(error.message)}finally{document.querySelector('#save-notifications').disabled=false}
});
async function saveNotificationSettings(){
 requireCloud();const mode=notificationMode(),hours=Number(document.querySelector('#interval-hours').value);
 if(mode==='interval'&&!validInterval(hours))throw Error('Enter a whole number of hours from 1 to 24.');
 const changed=mode!==(loadedNotificationSettings?.enabled?(loadedNotificationSettings.mode||'interval'):'never')||hours!==(loadedNotificationSettings?.interval_hours||1);
 const anchor=!changed&&loadedNotificationSettings?.interval_anchor?loadedNotificationSettings.interval_anchor:new Date(Math.floor(Date.now()/60000)*60000).toISOString();
 const settings={user_id:user.id,enabled:mode!=='never',mode,interval_hours:mode==='interval'?hours:loadedNotificationSettings?.interval_hours||1,interval_anchor:anchor,timezone:plan.timezone,start_hour:0,end_hour:23};
 const {error}=await cloud.from('notification_settings').upsert(settings);
 if(error){if(['PGRST204','42703'].includes(error.code))throw Error('The database needs the notification update. Run supabase/notification-modes.sql in Supabase SQL Editor, then save again.');throw error}
 loadedNotificationSettings=settings;pushStatus(mode==='never'?'Saved. Automatic notifications are off.':mode==='interval'?`Saved. Progress updates repeat every ${hours} ${hours===1?'hour':'hours'}.`:`Saved. Reminders are scheduled ${REMINDER_MINUTES} minutes before unfinished tasks.`);
}
async function enableDevice(){requireCloud();if(!isSecureContext||!('PushManager' in window)||!('Notification' in window))throw Error('This browser does not support push here. On iPhone, open the installed Home Screen app.');const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not allowed. Enable them in your phone or browser settings.');const key=await pushRequest('/public-key');const reg=registration||await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub){const bytes=Uint8Array.from(atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes})}const {error}=await cloud.from('push_subscriptions').upsert({user_id:user.id,endpoint:sub.endpoint,subscription:sub.toJSON()},{onConflict:'user_id,endpoint'});if(error)throw error;pushStatus('This device is connected. Choose when to receive notifications and save settings.');}
async function disconnectDevice(show=true){if(!user||!cloud)return;const reg=registration||await navigator.serviceWorker?.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub){const {error}=await cloud.from('push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',sub.endpoint);if(error)throw error;await sub.unsubscribe()}if(show)pushStatus('This device is disconnected.');}
for(const [id,action] of [['enable-device',enableDevice],['disable-device',()=>disconnectDevice()],['test-push',async()=>{
 const mode=notificationMode(),hours=Number(document.querySelector('#interval-hours').value);
 if(mode==='interval'&&!validInterval(hours))throw Error('Enter a whole number of hours from 1 to 24.');
 document.querySelector('#notification-preview').hidden=true;
 const result=await pushRequest('/test',{method:'POST',body:JSON.stringify({mode,interval_hours:mode==='interval'?hours:1})});
 if(result.example){document.querySelector('#preview-title').textContent=result.example.title;document.querySelector('#preview-body').textContent=result.example.body;document.querySelector('#notification-preview').hidden=false}
 pushStatus('Test sent. This is an example of your selected notification option.');
 }],['save-notifications',saveNotificationSettings]] )document.getElementById(id).addEventListener('click',async e=>{e.currentTarget.disabled=true;try{await action()}catch(error){pushStatus(error.message)}finally{document.getElementById(id).disabled=false}});

renderPlan(readCache()?.plan||emptyPlan());
if(cloud){hydrating=true;cloud.auth.getSession().then(({data,error})=>{if(error)throw error;return loadAccount(data.session?.user||null)}).catch(()=>{hydrating=false;saveStatus('Could not restore login. Log in to sync.',true)});cloud.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY')setTimeout(()=>document.querySelector('#recovery-dialog').showModal(),0);if(['SIGNED_IN','SIGNED_OUT'].includes(event))setTimeout(()=>loadAccount(session?.user||null),0)})}else{saveStatus('Saved on this device · Cloud login not configured')}
