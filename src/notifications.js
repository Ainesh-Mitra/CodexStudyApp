import {dateParts,summary} from './model.js';
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
 const target=new Date(now.getTime()+5*60000),local=dateParts(target,plan.timezone);
 return plan.tasks.filter(task=>task.day===local.weekday&&task.start*15===local.hour*60+local.minute&&task.completedOn!==local.date).map(task=>{
  const subject=plan.subjects.find(s=>s.id===task.subjectId);
  const key=`before:${local.date}:${task.id}:${task.start}`;
  return {slot:key,message:{title:'Starting in 5 minutes',body:`${task.title} · ${subject?.name||''}\n\n${summary(plan,target).body}`,tag:key,url:'/'}};
 });
}
