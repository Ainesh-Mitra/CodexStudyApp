import {dateParts,summary,emptyPlan} from './model.js';
export const REMINDER_MINUTES=15;
export function validInterval(value){return Number.isInteger(value)&&value>=1&&value<=24}
export function scheduledNotifications(setting,plan,now=new Date()){
 if(!setting.enabled||setting.mode==='never'||plan.timezone!==setting.timezone)return [];
 const mode=setting.mode||'interval';
 if(mode==='interval'){
  const hours=setting.interval_hours??1;if(!validInterval(hours))return [];
  if(setting.interval_anchor){
   const anchor=Date.parse(setting.interval_anchor);if(!Number.isFinite(anchor))return [];
   const elapsed=Math.floor(now.getTime()/60000)-Math.floor(anchor/60000);
   if(elapsed<=0||elapsed%(hours*60)!==0)return [];
  }else{
   // Keep pre-migration hourly settings working until the database is upgraded.
   const local=dateParts(now,plan.timezone);if(local.minute!==0)return [];
   const start=setting.start_hour??0,end=setting.end_hour??23;
   if(!(start<=end?local.hour>=start&&local.hour<=end:local.hour>=start||local.hour<=end))return [];
  }
  return [{slot:`interval:${now.toISOString().slice(0,16)}`,message:summary(plan,now)}];
 }
 if(mode!=='before_task')return [];
 const target=new Date(now.getTime()+REMINDER_MINUTES*60000),local=dateParts(target,plan.timezone);
 return plan.tasks.filter(task=>task.day===local.weekday&&task.start*15===local.hour*60+local.minute&&task.completedOn!==local.date).map(task=>{
  const key=`before:${local.date}:${task.id}:${task.start}`;
  return {slot:key,message:{...taskReminder(plan,task,target),tag:key}};
 });
}

function taskReminder(plan,task,target){
 const subject=plan.subjects.find(s=>s.id===task.subjectId);
 return {title:`Starting in ${REMINDER_MINUTES} minutes`,body:`${task.title} · ${subject?.name||''}\n\n${summary(plan,target).body}`,url:'/'};
}
export function exampleNotification(plan,mode,now=new Date()){
 if(mode==='never')return {title:'Example · Notifications off',body:'Never is selected. You will not receive automatic notifications. This message is only a test.',tag:'dayline-test',url:'/'};
 let preview=plan,local=dateParts(now,plan.timezone);
 const today=plan.tasks.filter(t=>t.day===local.weekday).sort((a,b)=>a.start-b.start);
 let task=today.find(t=>t.completedOn!==local.date&&t.start*15>=local.hour*60+local.minute)||today.find(t=>t.completedOn!==local.date);
 if(!today.length||(mode==='before_task'&&!task)){
  preview=emptyPlan();preview.timezone=plan.timezone;
  preview.tasks=[{id:'example-done',subjectId:preview.subjects[0].id,title:'Finish algebra homework',day:local.weekday,start:32,end:36,completedOn:local.date},{id:'example-next',subjectId:preview.subjects[2].id,title:'Write essay introduction',day:local.weekday,start:40,end:44,completedOn:null}];
  task=preview.tasks[1];
 }
 const message=mode==='before_task'?taskReminder(preview,task,now):summary(preview,now);
 return {...message,title:`Example · ${message.title}`,tag:'dayline-test'};
}
