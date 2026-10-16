export function dateParts(date,timezone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,weekday:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday),hour:Number(parts.hour),minute:Number(parts.minute)};
}
export function emptyPlan(){return {version:1,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',subjects:[{id:crypto.randomUUID(),name:'Math',color:'#4f7de9'},{id:crypto.randomUUID(),name:'Science',color:'#2aab7b'},{id:crypto.randomUUID(),name:'Writing',color:'#9862dc'}],tasks:[]}}
export function validatePlan(value){
 if(!value||value.version!==1||!Array.isArray(value.subjects)||!Array.isArray(value.tasks)||value.subjects.length>100||value.tasks.length>672)throw Error('Invalid planner data.');
 new Intl.DateTimeFormat('en',{timeZone:value.timezone}).format();
 const ids=new Set();for(const s of value.subjects){if(typeof s.id!=='string'||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>40||!/^#[0-9a-f]{6}$/i.test(s.color))throw Error('Invalid subject.');ids.add(s.id)}
 const taskIds=new Set();for(const t of value.tasks){if(typeof t.id!=='string'||taskIds.has(t.id)||!ids.has(t.subjectId)||typeof t.title!=='string'||!t.title.trim()||t.title.length>80||![t.day,t.start,t.end].every(Number.isInteger)||t.day<0||t.day>6||t.start<0||t.end>96||t.start>=t.end||t.completedOn!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(t.completedOn))throw Error('Invalid task.');taskIds.add(t.id)}
 for(let day=0;day<7;day++){const tasks=value.tasks.filter(t=>t.day===day).sort((a,b)=>a.start-b.start);for(let i=1;i<tasks.length;i++)if(tasks[i].start<tasks[i-1].end)throw Error('Tasks overlap.');}
 return value;
}
export function summary(plan,now=new Date()){
 const local=dateParts(now,plan.timezone),tasks=plan.tasks.filter(t=>t.day===local.weekday).sort((a,b)=>a.start-b.start),done=tasks.filter(t=>t.completedOn===local.date).length;
 const next=tasks.find(t=>t.end>local.hour*4+Math.floor(local.minute/15)&&t.completedOn!==local.date);
 return {title:'Your Dayline update',body:`${done} of ${tasks.length} tasks complete. ${tasks.length-done} remaining.${next?` Next: ${next.title.slice(0,80)}.`:''}`,tag:`dayline-${local.date}-${local.hour}`,url:'/'};
}
