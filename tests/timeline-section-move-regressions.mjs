import assert from "node:assert/strict";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

const path = (id) => `/api/tasks/${id}/timeline-row`;

async function setup(label) {
  const f = await fixtures(`Timeline section ${label}`);
  const { rows: a } = await db.query(
    "INSERT INTO sections (project_id,name) VALUES ($1,'A first'),($1,'A second') RETURNING id",
    [f.a],
  );
  const { rows: b } = await db.query(
    "INSERT INTO sections (project_id,name) VALUES ($1,'B first'),($1,'B second') RETURNING id",
    [f.b],
  );
  const id = await task(f.a, `Placement ${label}`);
  await db.query(
    "UPDATE tasks SET section_id=$2,start_on='2030-06-01',due_on='2030-06-05',position=123,progress=20 WHERE id=$1",
    [id,a[0].id],
  );
  await db.query(
    "INSERT INTO task_project_memberships (task_id,project_id,section_id) VALUES ($1,$2,$4),($1,$3,$5)",
    [id,f.a,f.b,a[0].id,b[0].id],
  );
  return { ...f,id,a1:Number(a[0].id),a2:Number(a[1].id),b1:Number(b[0].id),b2:Number(b[1].id) };
}

async function state(id) {
  const { rows:[row] } = await db.query("SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1",[id]);
  const { rows:memberships } = await db.query(
    "SELECT project_id::int,section_id::int FROM task_project_memberships WHERE task_id=$1 ORDER BY project_id",[id],
  );
  const { rows:pins } = await db.query(
    "SELECT project_id::int,row_index,updated_by::int,updated_at::text AS updated_at FROM task_timeline_rows WHERE task_id=$1 ORDER BY project_id",[id],
  );
  const { rows:events } = await db.query(
    "SELECT project_id::int,type,data FROM domain_events WHERE subject_type='task' AND subject_id=$1 ORDER BY id",[id],
  );
  return {task:row?.data??null,memberships,pins,events};
}

async function placement(f,project,section,row=2) {
  const { rows:[value] } = await db.query(
    `SELECT t.updated_at::text AS task_stamp,
       CASE WHEN t.project_id=$2 THEN t.section_id ELSE m.section_id END AS section_id,
       p.updated_at::text AS pin_stamp
     FROM tasks t LEFT JOIN task_project_memberships m ON m.task_id=t.id AND m.project_id=$2
     LEFT JOIN task_timeline_rows p ON p.task_id=t.id AND p.project_id=$2 WHERE t.id=$1`,[f.id,project],
  );
  return {project_id:project,section_id:section,row_index:row,
    expected_section_id:value.section_id===null?null:Number(value.section_id),
    expected_task_updated_at:value.task_stamp,expected_updated_at:value.pin_stamp??null};
}

const unchangedTask = (row) => {
  const copy={...row};delete copy.section_id;delete copy.updated_at;return copy;
};

test("timeline primary section placement atomically preserves dates, other homes, dependencies and their pins",async()=>{
  const f=await setup("primary");
  const child=await task(f.a,"Child kept in the original section",f.id);
  const dependency=await task(f.a,"Dependency kept intact");
  await db.query("INSERT INTO task_dependencies (task_id,depends_on_id) VALUES ($1,$2)",[f.id,dependency]);
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:1,expected_updated_at:null});
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.b,row_index:7,expected_updated_at:null});
  const before=await state(f.id),childBefore=await state(child);
  const body=await placement(f,f.a,f.a2,4);
  const result=await request(f.owner,"PUT",path(f.id),200,body);
  const after=await state(f.id);
  assert.deepEqual(unchangedTask(after.task),unchangedTask(before.task));
  assert.equal(after.task.section_id,f.a2);
  assert.notEqual(result.task_updated_at,body.expected_task_updated_at);
  assert.notEqual(result.updated_at,body.expected_updated_at);
  assert.equal(result.section_id,f.a2);
  assert.deepEqual(after.memberships,[{project_id:f.a,section_id:f.a2},{project_id:f.b,section_id:f.b1}]);
  assert.deepEqual(after.pins.find(p=>p.project_id===f.b),before.pins.find(p=>p.project_id===f.b));
  assert.equal(after.pins.find(p=>p.project_id===f.a).row_index,4);
  assert.deepEqual(after.events,[{project_id:f.a,type:"task.section_changed",data:{previous_section_id:f.a1,section_id:f.a2}}]);
  assert.deepEqual(await state(child),childBefore);
  assert.equal((await db.query("SELECT 1 FROM task_dependencies WHERE task_id=$1 AND depends_on_id=$2",[f.id,dependency])).rowCount,1);
});

test("timeline a secondary-only editor changes only that home's section and pin",async()=>{
  const f=await setup("secondary");
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",[f.a,f.editorId]);
  await db.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'editor')",[f.b,f.editorId]);
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:3,expected_updated_at:null});
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.b,row_index:6,expected_updated_at:null});
  const before=await state(f.id),body=await placement(f,f.b,f.b2,2);
  const result=await request(f.editor,"PUT",path(f.id),200,body),after=await state(f.id);
  assert.deepEqual({...after.task,updated_at:before.task.updated_at},before.task);
  assert.equal(after.task.project_id,f.a);assert.equal(after.task.section_id,f.a1);
  assert.notEqual(result.task_updated_at,body.expected_task_updated_at);
  assert.deepEqual(after.memberships,[{project_id:f.a,section_id:f.a1},{project_id:f.b,section_id:f.b2}]);
  assert.deepEqual(after.pins.find(p=>p.project_id===f.a),before.pins.find(p=>p.project_id===f.a));
  assert.equal(after.pins.find(p=>p.project_id===f.b).row_index,2);
  assert.deepEqual(after.events,[{project_id:f.b,type:"task.section_changed",data:{previous_section_id:f.b1,section_id:f.b2}}]);
});

for(const home of ["primary","secondary"]){
  test(`timeline ${home} placement supports moving to and from no section`,async()=>{
    const f=await setup(`null ${home}`),project=home==="primary"?f.a:f.b,target=home==="primary"?f.a2:f.b2;
    const before=await state(f.id);
    await request(f.owner,"PUT",path(f.id),200,await placement(f,project,null,0));
    let after=await state(f.id);
    assert.equal(home==="primary"?after.task.section_id:after.memberships.find(m=>m.project_id===project).section_id,null);
    assert.deepEqual(unchangedTask(after.task),unchangedTask(before.task));
    await request(f.owner,"PUT",path(f.id),200,await placement(f,project,target,3));
    after=await state(f.id);
    assert.equal(home==="primary"?after.task.section_id:after.memberships.find(m=>m.project_id===project).section_id,target);
    assert.deepEqual(unchangedTask(after.task),unchangedTask(before.task));
    assert.equal(after.events.length,2);
  });
}

test("timeline row-only clients stay compatible and same-section pinning emits no section event",async()=>{
  const f=await setup("legacy row");
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:1});
  const before=await state(f.id);
  await request(f.owner,"PUT",path(f.id),200,await placement(f,f.a,f.a1,5));
  const after=await state(f.id);
  assert.deepEqual(after.task,before.task);assert.deepEqual(after.memberships,before.memberships);
  assert.deepEqual(after.events,[]);assert.equal(after.pins[0].row_index,5);
});

test("timeline section placement may clear a pin atomically without altering other homes",async()=>{
  const f=await setup("automatic target");
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:1});
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.b,row_index:7});
  const before=await state(f.id);
  const result=await request(f.owner,"PUT",path(f.id),200,await placement(f,f.a,f.a2,null));
  const after=await state(f.id);
  assert.equal(result.updated_at,null);assert.equal(after.task.section_id,f.a2);
  assert.deepEqual(after.pins,[before.pins.find(p=>p.project_id===f.b)]);
});

test("timeline section placement requires all three preconditions and validates targets and rows",async()=>{
  const f=await setup("validation"),body=await placement(f,f.a,f.a2),before=await state(f.id);
  for(const field of ["expected_section_id","expected_task_updated_at","expected_updated_at"]){
    const invalid={...body};delete invalid[field];
    await request(f.owner,"PUT",path(f.id),400,invalid);
  }
  for(const patch of [{section_id:0},{section_id:-1},{section_id:true},{section_id:String(f.a2)},
    {expected_section_id:true},{expected_section_id:0},{expected_task_updated_at:""},{expected_updated_at:false},
    {row_index:-1},{row_index:201}])await request(f.owner,"PUT",path(f.id),400,{...body,...patch});
  assert.deepEqual(await state(f.id),before);
});

test("timeline placement rejects a viewer, another project's section and an unowned task",async()=>{
  const f=await setup("authorization"),before=await state(f.id),body=await placement(f,f.a,f.a2);
  await db.query("UPDATE project_members SET role='viewer' WHERE user_id=$1 AND project_id=$2",[f.editorId,f.a]);
  await request(f.editor,"PUT",path(f.id),403,body);
  await request(f.owner,"PUT",path(f.id),400,{...body,section_id:f.b1});
  const outsider=await task(f.b,"No membership in A");
  await request(f.owner,"PUT",path(outsider),404,{...body});
  assert.deepEqual(await state(f.id),before);
  assert.deepEqual((await state(outsider)).pins,[]);
});

test("timeline stale task, source-section and pin versions cannot partially move a task",async()=>{
  const f=await setup("conflicts");
  const staleTask=await placement(f,f.a,f.a2);
  await db.query("UPDATE tasks SET name='Concurrent title',updated_at=updated_at+interval '1 second' WHERE id=$1",[f.id]);
  let current=await state(f.id);
  await request(f.owner,"PUT",path(f.id),409,staleTask);
  assert.deepEqual(await state(f.id),current);
  const staleSection=await placement(f,f.b,f.b2);
  await request(f.owner,"POST","/api/memberships",201,{task_id:f.id,project_id:f.b,section_id:f.b2});
  current=await state(f.id);
  await request(f.owner,"PUT",path(f.id),409,staleSection);
  assert.deepEqual(await state(f.id),current);
  const automatic=await placement(f,f.a,f.a2);
  const pin=await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:6,expected_updated_at:null});
  current=await state(f.id);
  await request(f.owner,"PUT",path(f.id),409,automatic);
  assert.deepEqual(await state(f.id),current);
  const oldPin=await placement(f,f.a,f.a2);
  await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:7,expected_updated_at:pin.updated_at});
  current=await state(f.id);
  await request(f.owner,"PUT",path(f.id),409,oldPin);
  assert.deepEqual(await state(f.id),current);
});

async function failureTrigger(table,taskColumn,id){
  const name=`timeline_failure_${id}`;
  assert.match(name,/^[a-z0-9_]+$/);assert.match(table,/^[a-z_]+$/);assert.match(taskColumn,/^[a-z_]+$/);
  await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected timeline placement failure'; END $$`);
  await db.query(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW WHEN (NEW.${taskColumn}=${Number(id)}) EXECUTE FUNCTION ${name}()`);
  return async()=>{
    await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    await db.query(`DROP FUNCTION IF EXISTS ${name}()`);
  };
}

for(const [target,column] of [["task_timeline_rows","task_id"],["domain_events","subject_id"]]){
  test(`timeline ${target} failure rolls back section, row and outbox together`,async()=>{
    const f=await setup(`rollback ${target}`);
    await request(f.owner,"PUT",path(f.id),200,{project_id:f.a,row_index:1});
    const body=await placement(f,f.a,f.a2,4),before=await state(f.id);
    const remove=await failureTrigger(target,column,f.id);
    try{await request(f.owner,"PUT",path(f.id),500,body);}finally{await remove();}
    assert.deepEqual(await state(f.id),before);
  });
}

test("timeline concurrent section drops accept one version and keep a matching row and one event",async()=>{
  for(let attempt=0;attempt<8;attempt++){
    const f=await setup(`concurrent ${attempt}`),body=await placement(f,f.a,f.a2,4);
    const responses=await Promise.all([
      http(path(f.id),{cookie:f.owner,method:"PUT",json:body,timeout:10_000}),
      http(path(f.id),{cookie:f.owner,method:"PUT",json:{...body,section_id:null,row_index:7},timeout:10_000}),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const after=await state(f.id);
    assert.equal(after.events.length,1);
    assert.equal(after.events[0].data.section_id,after.task.section_id);
    assert.equal(after.pins[0].row_index,after.task.section_id===f.a2?4:7);
  }
});

async function waitForBlockedQuery(pattern){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const r=await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",[pattern]);
    if(r.rowCount)return;
    await delay(25);
  }
  assert.fail(`Expected lock wait: ${pattern}`);
}

test("timeline a move queued behind membership removal cannot restore a removed home",async()=>{
  const f=await setup("membership removal race"),body=await placement(f,f.b,f.b2,5),locker=await db.connect();
  let removing,moving;
  try{
    await locker.query("BEGIN");await locker.query("LOCK TABLE task_project_memberships IN SHARE MODE");
    removing=http(`/api/memberships?task_id=${f.id}&project_id=${f.b}`,{cookie:f.owner,method:"DELETE",timeout:10_000});
    void removing.catch(()=>undefined);
    await waitForBlockedQuery("DELETE FROM task_project_memberships%");
    moving=http(path(f.id),{cookie:f.owner,method:"PUT",json:body,timeout:10_000});void moving.catch(()=>undefined);
    await waitForBlockedQuery("SELECT project_id, section_id,%updated_at::text AS updated_at FROM tasks%FOR UPDATE");
  }finally{await locker.query("ROLLBACK");locker.release();}
  const [removed,moved]=await Promise.all([removing,moving]);
  assert.equal(removed.status,200,await removed.text());assert.equal(moved.status,404,await moved.text());
  const after=await state(f.id);
  assert.deepEqual(after.pins,[]);assert.equal(after.task.section_id,f.a1);
  assert.equal(after.memberships.some(m=>m.project_id===f.b),false);
  assert.deepEqual(after.events,[]);
});

test("timeline destination deletion while waiting leaves source and pin unchanged",async()=>{
  const f=await setup("destination removal race"),body=await placement(f,f.a,f.a2,5),locker=await db.connect();
  const before=await state(f.id);let moving;
  try{
    await locker.query("BEGIN");await locker.query("DELETE FROM sections WHERE id=$1",[f.a2]);
    moving=http(path(f.id),{cookie:f.owner,method:"PUT",json:body,timeout:10_000});void moving.catch(()=>undefined);
    await waitForBlockedQuery("SELECT id FROM sections%FOR KEY SHARE");
    await locker.query("COMMIT");
  }finally{await locker.query("ROLLBACK");locker.release();}
  const response=await moving;
  assert.equal(response.status,400,await response.text());
  assert.deepEqual(await state(f.id),before);
});

for(const home of ["primary","secondary"]){
  test(`timeline ${home} source deletion cannot deadlock a same-section row drop`,async()=>{
    const f=await setup(`source deletion ${home}`);
    const project=home==="primary"?f.a:f.b,section=home==="primary"?f.a1:f.b1;
    await request(f.owner,"PUT",path(f.id),200,{project_id:project,row_index:1});
    const body=await placement(f,project,section,4),locker=await db.connect();
    let moving,deleting;
    try{
      await locker.query("BEGIN");
      // Pause after the placement has obtained its source/target/task locks.
      // With the old task-first order, DELETE would own the section and wait
      // for the task/membership while placement subsequently waited on DELETE.
      await locker.query("LOCK TABLE task_timeline_rows IN ACCESS EXCLUSIVE MODE");
      moving=http(path(f.id),{cookie:f.owner,method:"PUT",json:body,timeout:10_000});void moving.catch(()=>undefined);
      await waitForBlockedQuery("SELECT updated_at::text AS updated_at FROM task_timeline_rows%");
      deleting=http(`/api/sections/${section}`,{cookie:f.owner,method:"DELETE",timeout:10_000});void deleting.catch(()=>undefined);
      await waitForBlockedQuery("DELETE FROM sections WHERE id = $1::bigint%");
    }finally{await locker.query("ROLLBACK");locker.release();}
    const [moved,deleted]=await Promise.all([moving,deleting]);
    assert.equal(moved.status,200,await moved.text());assert.equal(deleted.status,200,await deleted.text());
    const after=await state(f.id);
    assert.equal(after.task.project_id,f.a);
    assert.equal(after.task.section_id,home==="primary"?null:f.a1);
    assert.equal(after.memberships.find(m=>m.project_id===project).section_id,null);
    assert.equal(after.pins.find(p=>p.project_id===project).row_index,4);
    assert.equal(after.task.start_on,"2030-06-01");assert.equal(after.task.due_on,"2030-06-05");
    assert.deepEqual(after.events,[],"same-section pinning is not a section-move event");
  });
}

test("timeline section moves and project deletion share the deletion gate without deadlocking",async()=>{
  const f=await setup("project deletion race"),body=await placement(f,f.a,f.a2,5),locker=await db.connect();
  let moving,deleting;
  try{
    await locker.query("BEGIN");await locker.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE",[f.id]);
    moving=http(path(f.id),{cookie:f.owner,method:"PUT",json:body,timeout:10_000});void moving.catch(()=>undefined);
    await waitForBlockedQuery("SELECT project_id, section_id,%updated_at::text AS updated_at FROM tasks%FOR UPDATE");
    deleting=http(`/api/projects/${f.a}`,{cookie:f.owner,method:"DELETE",timeout:10_000});void deleting.catch(()=>undefined);
    await waitForBlockedQuery("SELECT pg_advisory_xact_lock(1096043603, 2)%");
  }finally{await locker.query("ROLLBACK");locker.release();}
  const [moved,deleted]=await Promise.all([moving,deleting]);
  assert.equal(moved.status,200,await moved.text());assert.equal(deleted.status,200,await deleted.text());
  const after=await state(f.id);
  assert.equal(after.task.project_id,f.b);assert.equal(after.task.section_id,f.b1);
  assert.equal(after.task.start_on,"2030-06-01");assert.equal(after.task.due_on,"2030-06-05");
  assert.deepEqual(after.pins,[]);
});


async function insertionFixture(label) {
  const f=await setup(label),peer=await task(f.a,"Insertion peer");
  await db.query("UPDATE tasks SET section_id=$2,start_on='2030-06-02',due_on='2030-06-06' WHERE id=$1",[peer,f.a1]);
  const version=await placement({...f,id:peer},f.a,f.a1,1);
  const body=await placement(f,f.a,f.a1,0);
  body.placements=[{task_id:peer,row_index:1,expected_updated_at:version.expected_updated_at,expected_task_updated_at:version.expected_task_updated_at}];
  return {f,peer,body};
}
test("row insertion atomically pins automatic peers without changing dates or other homes",async()=>{
  const {f,peer,body}=await insertionFixture("insert");
  const before=await state(f.id),peerBefore=await state(peer);
  await request(f.owner,"PUT",path(f.id),200,body);
  const after=await state(f.id),peerAfter=await state(peer);
  assert.deepEqual(after.task,before.task);assert.deepEqual(peerAfter.task,peerBefore.task);
  assert.deepEqual(after.memberships,before.memberships);assert.deepEqual(after.events,before.events);
  assert.equal(after.pins.find(p=>p.project_id===f.a).row_index,0);
  assert.equal(peerAfter.pins.find(p=>p.project_id===f.a).row_index,1);
});
test("stale peer versions reject the entire row insertion before any pin changes",async()=>{
  const {f,peer,body}=await insertionFixture("stale peer");
  await request(f.owner,"PUT",path(peer),200,{project_id:f.a,row_index:4});
  const before=await state(f.id),peerBefore=await state(peer);
  await request(f.owner,"PUT",path(f.id),409,body);
  assert.deepEqual(await state(f.id),before);assert.deepEqual(await state(peer),peerBefore);
});
test("peer write failure rolls back the dragged row and every placement",async()=>{
  const {f,peer,body}=await insertionFixture("peer rollback");
  const before=await state(f.id),peerBefore=await state(peer);
  const remove=await failureTrigger("task_timeline_rows","task_id",peer);
  try{await request(f.owner,"PUT",path(f.id),500,body);}finally{await remove();}
  assert.deepEqual(await state(f.id),before);assert.deepEqual(await state(peer),peerBefore);
});
test("insertion cannot move a peer from another project or another section",async()=>{
  const {f,peer,body}=await insertionFixture("peer scope");
  await db.query("UPDATE tasks SET section_id=$2 WHERE id=$1",[peer,f.a2]);
  await request(f.owner,"PUT",path(f.id),409,body);
  const foreign=await task(f.b,"Foreign insertion peer");
  body.placements[0].task_id=foreign;
  await request(f.owner,"PUT",path(f.id),404,body);
  assert.equal((await state(f.id)).pins.length,0);
});
test("simultaneous insertions with a shared peer accept only one complete plan",async()=>{
  const {f,peer,body}=await insertionFixture("concurrent insert");
  const second=await task(f.a,"Other dragged task");
  await db.query("UPDATE tasks SET section_id=$2 WHERE id=$1",[second,f.a1]);
  const other={...await placement({...f,id:second},f.a,f.a1,0),placements:body.placements};
  const responses=await Promise.all([
    http(path(f.id),{cookie:f.owner,method:"PUT",json:body}),
    http(path(second),{cookie:f.owner,method:"PUT",json:other}),
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await state(peer)).pins[0].row_index,1);
  assert.equal((await state(f.id)).pins.length+(await state(second)).pins.length,1);
});


async function history(id) {
  return (await db.query("SELECT kind,summary FROM task_events WHERE task_id=$1 ORDER BY id",[id])).rows;
}
const withoutDates = row => {
  const copy=unchangedTask(row);delete copy.start_on;delete copy.due_on;return copy;
};
for (const crossSection of [false,true]) {
  test(`diagonal placement saves November 9 to November 1 with ${crossSection ? "a section change" : "same-section insertion"}`,async()=>{
    const {f,peer,body}=await insertionFixture(`diagonal ${crossSection}`);
    await db.query("UPDATE tasks SET start_on='2030-11-09',due_on='2030-11-13' WHERE id=$1",[f.id]);
    if(crossSection) {
      await db.query("UPDATE tasks SET section_id=$2 WHERE id=$1",[peer,f.a2]);
      body.section_id=f.a2;
    }
    const before=await state(f.id),peerBefore=await state(peer);
    await request(f.owner,"PUT",path(f.id),200,{...body,date_delta:-8});
    const after=await state(f.id);
    assert.equal(after.task.start_on,'2030-11-01');assert.equal(after.task.due_on,'2030-11-05');
    assert.equal(after.task.section_id,crossSection?f.a2:f.a1);
    assert.deepEqual(withoutDates(after.task),withoutDates(before.task));
    assert.deepEqual((await state(peer)).task,peerBefore.task);
    assert.equal(after.pins.find(p=>p.project_id===f.a).row_index,0);
    assert.equal((await state(peer)).pins.find(p=>p.project_id===f.a).row_index,1);
    assert.deepEqual(after.events.filter(e=>e.type==='task.due_changed'),[{project_id:f.a,type:'task.due_changed',data:{previous_due_on:'2030-11-13',due_on:'2030-11-05'}}]);
    assert.equal(after.events.filter(e=>e.type==='task.section_changed').length,crossSection?1:0);
    assert.deepEqual((await history(f.id)).map(h=>h.kind),['start_changed','due_changed']);
  });
}

test("secondary-only editors shift shared dates while retaining primary and other-home layout",async()=>{
  const f=await setup('secondary date shift');
  await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",[f.a,f.editorId]);
  await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",[f.b,f.editorId]);
  await request(f.owner,'PUT',path(f.id),200,{project_id:f.a,row_index:7});
  const before=await state(f.id);
  await request(f.editor,'PUT',path(f.id),200,{...await placement(f,f.b,f.b2,2),date_delta:3});
  const after=await state(f.id);
  assert.equal(after.task.start_on,'2030-06-04');assert.equal(after.task.due_on,'2030-06-08');
  assert.equal(after.task.section_id,f.a1);assert.equal(after.task.project_id,f.a);
  assert.deepEqual(after.pins.find(p=>p.project_id===f.a),before.pins[0]);
  assert.deepEqual(after.memberships,[{project_id:f.a,section_id:f.a1},{project_id:f.b,section_id:f.b2}]);
  assert.equal(after.events.find(e=>e.type==='task.due_changed').project_id,f.b);
});

test("diagonal dates reject invalid deltas, missing versions, viewer access and absent memberships without writes",async()=>{
  const f=await setup('invalid delta'),body=await placement(f,f.a,f.a2),before=await state(f.id);
  for(const delta of [null,true,'8',1.5,3660001,-3660001,{},[]]) await request(f.owner,'PUT',path(f.id),400,{...body,date_delta:delta});
  await request(f.owner,'PUT',path(f.id),400,{project_id:f.a,row_index:1,date_delta:1});
  await request(f.owner,'PUT',path(f.id),400,{...body,row_index:null,date_delta:1});
  for(const field of ['expected_updated_at','expected_task_updated_at','expected_section_id']) {
    const invalid={...body,date_delta:1};delete invalid[field];
    await request(f.owner,'PUT',path(f.id),400,invalid);
  }
  await db.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",[f.a,f.editorId]);
  await request(f.editor,'PUT',path(f.id),403,{...body,date_delta:1});
  const foreign=await task(f.b,'Foreign dated task');
  await request(f.owner,'PUT',path(foreign),404,{...body,date_delta:1});
  assert.deepEqual(await state(f.id),before);assert.deepEqual(await history(f.id),[]);
});

test("diagonal dates preserve missing endpoints and milestone type across leap days and year boundaries",async()=>{
  const cases=[
    ['2032-02-28','2032-03-02',1,'2032-02-29','2032-03-03',false],
    [null,'2030-01-01',-1,null,'2029-12-31',true],
    ['2030-12-31',null,1,'2031-01-01',null,false],
  ];
  for(const [start,due,delta,nextStart,nextDue,milestone] of cases) {
    const f=await setup(`date boundary ${delta} ${milestone}`);
    await db.query('UPDATE tasks SET start_on=$2::date,due_on=$3::date,is_milestone=$4 WHERE id=$1',[f.id,start,due,milestone]);
    await request(f.owner,'PUT',path(f.id),200,{...await placement(f,f.a,f.a2),date_delta:delta});
    const after=await state(f.id);
    assert.equal(after.task.start_on,nextStart);assert.equal(after.task.due_on,nextDue);assert.equal(after.task.is_milestone,milestone);
  }
});

test("out-of-range dates and undated tasks cannot partially save a diagonal placement",async()=>{
  for(const [start,due,delta] of [['9999-12-31','9999-12-31',1],['0001-01-01','0001-01-01',-1],[null,null,1]]) {
    const f=await setup('date range');
    await db.query('UPDATE tasks SET start_on=$2::date,due_on=$3::date WHERE id=$1',[f.id,start,due]);
    const before=await state(f.id);
    await request(f.owner,'PUT',path(f.id),400,{...await placement(f,f.a,f.a2),date_delta:delta});
    assert.deepEqual(await state(f.id),before);assert.deepEqual(await history(f.id),[]);
  }
});

for(const failure of ['peer','outbox','history']) {
  test(`diagonal ${failure} failure rolls back dates, section, main/peer pins and history`,async()=>{
    const {f,peer,body}=await insertionFixture(`diagonal rollback ${failure}`);
    await db.query('UPDATE tasks SET section_id=$2 WHERE id=$1',[peer,f.a2]);
    body.section_id=f.a2;
    const before=await state(f.id),peerBefore=await state(peer);
    const remove=await failureTrigger(failure==='peer'?'task_timeline_rows':failure==='outbox'?'domain_events':'task_events',failure==='outbox'?'subject_id':'task_id',failure==='peer'?peer:f.id);
    try { await request(f.owner,'PUT',path(f.id),500,{...body,date_delta:-8}); } finally { await remove(); }
    assert.deepEqual(await state(f.id),before);assert.deepEqual(await state(peer),peerBefore);assert.deepEqual(await history(f.id),[]);
  });
}

test("concurrent diagonal moves apply the winning date offset exactly once with its matching section and row",async()=>{
  for(let attempt=0;attempt<5;attempt++) {
    const f=await setup(`diagonal concurrent ${attempt}`),body=await placement(f,f.a,f.a2,4);
    const responses=await Promise.all([
      http(path(f.id),{cookie:f.owner,method:'PUT',json:{...body,date_delta:-8}}),
      http(path(f.id),{cookie:f.owner,method:'PUT',json:{...body,section_id:null,row_index:7,date_delta:3}}),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const after=await state(f.id),first=after.task.section_id===f.a2;
    assert.equal(after.task.start_on,first?'2030-05-24':'2030-06-04');
    assert.equal(after.task.due_on,first?'2030-05-28':'2030-06-08');
    assert.equal(after.pins[0].row_index,first?4:7);
    assert.equal(after.events.filter(e=>e.type==='task.due_changed').length,1);
    assert.equal((await history(f.id)).length,2);
  }
});

test("a stale peer on a diagonal move leaves the dragged dates and all layout unchanged",async()=>{
  const {f,peer,body}=await insertionFixture('diagonal stale');
  await request(f.owner,'PUT',path(peer),200,{project_id:f.a,row_index:6});
  const before=await state(f.id),peerBefore=await state(peer);
  await request(f.owner,'PUT',path(f.id),409,{...body,date_delta:-8});
  assert.deepEqual(await state(f.id),before);assert.deepEqual(await state(peer),peerBefore);assert.deepEqual(await history(f.id),[]);
});


for (const access of ['both homes', 'secondary only', 'primary viewer', 'no primary']) {
  test(`TR01 ${access}: date events choose the same authorized home across horizontal, resize, detail and diagonal writes`, {timeout:30_000}, async()=>{
    await db.query("UPDATE domain_events SET processed_at=now() WHERE processed_at IS NULL AND failed_at IS NULL");
    const f=await setup(`TR01 ${access}`);
    let cookie=f.owner, expectedProject=f.a;
    if(access==='secondary only'||access==='primary viewer') {
      await db.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",[f.a,f.editorId]);
      if(access==='primary viewer') await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'viewer')",[f.a,f.editorId]);
      await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",[f.b,f.editorId]);
      cookie=f.editor;expectedProject=f.b;
    }
    if(access==='no primary') await db.query("UPDATE tasks SET project_id=NULL,section_id=NULL WHERE id=$1",[f.id]);
    const ruleIds=new Map();
    // Legacy tasks without a primary project still have an event-routing contract.
    // Exercise rule side effects for the supported primary + secondary layouts.
    for(const project of access==='no primary'?[]:[f.a,f.b]) {
      const {id}=await request(f.owner,'POST',`/api/projects/${project}/rules`,201,{
        name:`TR01 due ${project}`,definition:{triggers:[{event:'task.due_changed'}],actions:[{capability:'task.add_comment',params:{body:`TR01 due ${project}`}}]},
      });
      ruleIds.set(project,id);
    }
    const shift=value=>new Date(Date.parse(value+'T00:00:00Z')+86_400_000).toISOString().slice(0,10);
    const processed=[];
    for(const mode of ['horizontal','resize','detail','diagonal','same-section diagonal']) {
      const before=await state(f.id);
      const version=await placement(f,f.b,mode==='diagonal'?f.b2:before.memberships.find(m=>m.project_id===f.b).section_id,3);
      if(mode.includes('diagonal')) await request(cookie,'PUT',path(f.id),200,{...version,date_delta:1});
      else await request(cookie,'PATCH',`/api/tasks/${f.id}`,200,{
        expected_updated_at:version.expected_task_updated_at,due_on:shift(before.task.due_on),
        ...(mode==='horizontal'?{start_on:shift(before.task.start_on)}:{}),
      });
      const events=(await db.query("SELECT id,project_id FROM domain_events WHERE subject_id=$1 AND type='task.due_changed' ORDER BY id",[f.id])).rows;
      assert.equal(events.length,processed.length+1,`${mode} emits once`);
      const event=events.at(-1);assert.equal(Number(event.project_id),expectedProject,mode);
      for(let pass=0;pass<2;pass++) {
        const response=await http('/api/automation/process?limit=100',{method:'POST',timeout:10_000,headers:{'x-automation-token':'atlas-regression-worker'}});
        assert.equal(response.status,200,await response.text());
      }
      const runs=(await db.query("SELECT rule_id,status FROM rule_runs WHERE event_id=$1",[event.id])).rows;
      assert.deepEqual(runs,access==='no primary'?[]:[{rule_id:String(ruleIds.get(expectedProject)),status:'success'}],`${mode} executes only the authorized home's due rule once`);
      processed.push(event.id);
    }
    const after=await state(f.id);
    assert.equal(after.events.filter(e=>e.type==='task.section_changed').length,1);
    assert.equal(after.events.find(e=>e.type==='task.section_changed').project_id,f.b,'section events stay local');
    const comments=(await db.query("SELECT body FROM comments WHERE task_id=$1 ORDER BY id",[f.id])).rows;
    assert.deepEqual(comments.map(c=>c.body),access==='no primary'?[]:Array(5).fill(`TR01 due ${expectedProject}`));
    assert.equal(after.task.project_id,access==='no primary'?null:f.a);
  });
}

test('TR01 concurrent date placements resolve authorization on their transaction connection without exhausting the pool', {timeout:20_000}, async()=>{
  const f=await setup('TR01 pool'), jobs=[];
  for(let i=0;i<12;i++) {
    const id=await task(f.a,`TR01 concurrent ${i}`);
    await db.query("UPDATE tasks SET section_id=$2,start_on='2030-06-01',due_on='2030-06-05' WHERE id=$1",[id,f.a1]);
    jobs.push({id,body:{...await placement({...f,id},f.a,f.a2,1),date_delta:1}});
  }
  const locker=await db.connect();let requests=[];
  try {
    await locker.query('BEGIN');await locker.query('LOCK TABLE task_events IN ACCESS EXCLUSIVE MODE');
    requests=jobs.map(({id,body})=>http(path(id),{cookie:f.owner,method:'PUT',json:body,timeout:15_000}));
    requests.forEach(p=>void p.catch(()=>undefined));
    const deadline=Date.now()+5000;let waiting=0;
    while(Date.now()<deadline) {
      waiting=Number((await db.query("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%INSERT INTO task_events%'")).rows[0].n);
      if(waiting>=10)break;
      await delay(20);
    }
    assert.equal(waiting,10,'all application pool connections are held by placement transactions');
  } finally {await locker.query('ROLLBACK');locker.release();}
  const responses=await Promise.all(requests);
  for(const r of responses)assert.equal(r.status,200,await r.text());
  for(const {id} of jobs) {
    const saved=await state(id);
    assert.equal(saved.task.due_on,'2030-06-06');assert.equal(saved.task.section_id,f.a2);
    assert.equal(saved.events.filter(e=>e.type==='task.due_changed').length,1);
  }
});
