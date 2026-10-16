import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('database isolates two accounts and rejects stale writes and anonymous access',async()=>{
 const db=new PGlite();const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users values('${alice}'),('${bob}');`);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 const asUser=async id=>{await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`)};
 await asUser(alice);assert.equal((await db.query(`select public.save_planner($1::jsonb,0) as revision`,[JSON.stringify({private:'alice'})])).rows[0].revision,1);
 await db.query(`insert into public.notification_settings(user_id) values($1)`,[alice]);
 await db.query(`insert into public.push_subscriptions(user_id,endpoint,subscription) values($1,'https://fcm.googleapis.com/alice','{}')`,[alice]);
 await asUser(bob);assert.equal((await db.query('select * from public.planners')).rows.length,0);assert.equal((await db.query('select * from public.notification_settings')).rows.length,0);assert.equal((await db.query('select * from public.push_subscriptions')).rows.length,0);
 await assert.rejects(db.query(`insert into public.notification_settings(user_id) values($1)`,[alice]),/row-level security/);
 await db.query(`select public.save_planner('{"private":"bob"}',0)`);assert.equal((await db.query('select data from public.planners')).rows[0].data.private,'bob');
 await asUser(alice);await db.query(`select public.save_planner('{"private":"alice updated"}',1)`);await assert.rejects(db.query(`select public.save_planner('{}',1)`),/revision_conflict/);assert.equal((await db.query('select data from public.planners')).rows[0].data.private,'alice updated');
 await assert.rejects(db.query(`insert into public.push_deliveries(user_id,slot) values($1,'fake')`,[alice]),/permission denied/);
 await db.exec('reset role;set role service_role');
 assert.equal((await db.query('select * from public.planners')).rows.length,2);
 assert.equal((await db.query('select * from public.notification_settings')).rows.length,1);
 assert.equal((await db.query('select * from public.push_subscriptions')).rows.length,1);
 await db.query(`insert into public.push_deliveries(user_id,slot) values($1,'test')`,[alice]);
 assert.equal((await db.query('select * from public.push_deliveries')).rows.length,1);
 await db.query(`delete from public.push_deliveries where user_id=$1`,[alice]);
 await db.query(`delete from public.push_subscriptions where user_id=$1`,[alice]);
 await assert.rejects(db.query(`delete from public.planners where user_id=$1`,[alice]),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.planners'),/permission denied/);await assert.rejects(db.query("select public.save_planner('{}',0)"),/permission denied/);
 }finally{await db.close()}
});
