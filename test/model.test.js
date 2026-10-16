import test from 'node:test';import assert from 'node:assert/strict';
import {emptyPlan,dateParts,validatePlan,summary} from '../src/model.js';
function plan(){const p=emptyPlan();p.timezone='America/Los_Angeles';p.tasks=[{id:'one',subjectId:p.subjects[0].id,title:'Algebra',day:4,start:36,end:40,completedOn:'2026-10-16'}];return p}
test('daily notification lists completed and remaining titles for that recurring day',()=>{
 const p=plan();p.tasks.push({...p.tasks[0],id:'two',title:'Read chapter 4',start:40,end:44,completedOn:null});
 assert.equal(summary(p,new Date('2026-10-16T16:30:00Z')).body,'✅ Done\n• Algebra\n\n⏳ Left to do\n• Read chapter 4');
 assert.equal(summary(p,new Date('2026-10-23T16:30:00Z')).body,'✅ Done\n• Nothing yet\n\n⏳ Left to do\n• Algebra\n• Read chapter 4');
 assert.equal(summary(p,new Date('2026-10-17T16:30:00Z')).body,'No tasks scheduled today.');
 p.tasks[1].completedOn='2026-10-16';assert.match(summary(p,new Date('2026-10-16T16:30:00Z')).body,/Nothing left — all done!/);
});
test('long multilingual task lists stay within push payload limits and disclose omissions',()=>{
 const p=plan();p.tasks=Array.from({length:96},(_,i)=>({id:String(i),subjectId:p.subjects[0].id,title:'学'.repeat(80),day:4,start:i,end:i+1,completedOn:i<48?'2026-10-16':null}));
 const message=summary(p,new Date('2026-10-16T16:30:00Z'));assert.ok(new TextEncoder().encode(JSON.stringify(message)).length<3993);assert.match(message.body,/more \(open planner\)/);assert.match(message.body,/✅ Done/);assert.match(message.body,/⏳ Left to do/);p.tasks.forEach(t=>t.title='\"'.repeat(80));assert.ok(new TextEncoder().encode(JSON.stringify(summary(p,new Date('2026-10-16T16:30:00Z')))).length<3993);
});
test('local midnight and DST use IANA zones, not the server timezone',()=>{assert.equal(dateParts(new Date('2026-10-17T06:59:59Z'),'America/Los_Angeles').date,'2026-10-16');assert.equal(dateParts(new Date('2026-10-17T07:00:00Z'),'America/Los_Angeles').date,'2026-10-17');assert.equal(dateParts(new Date('2026-11-01T08:30:00Z'),'America/Los_Angeles').hour,1);assert.equal(dateParts(new Date('2026-11-01T09:30:00Z'),'America/Los_Angeles').hour,1);assert.equal(dateParts(new Date('2026-10-16T03:15:00Z'),'Asia/Kathmandu').hour,9)});
test('validation rejects overlaps, missing subjects and out-of-day ranges',()=>{const p=plan();assert.equal(validatePlan(p),p);p.tasks.push({...p.tasks[0],id:'two',start:39});assert.throws(()=>validatePlan(p),/overlap/);p.tasks.pop();p.tasks[0].end=97;assert.throws(()=>validatePlan(p));p.tasks[0].end=40;p.tasks[0].subjectId='missing';assert.throws(()=>validatePlan(p))});
