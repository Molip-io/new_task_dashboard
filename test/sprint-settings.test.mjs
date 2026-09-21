import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  readSprintSettings,
  saveSprintSettings,
  settingsWriteAuthorized,
  settingsOriginAllowed,
  readSettingsBody,
  decorateSprintDashboard,
  applySavedSprintSettings,
} from '../lib/sprint-settings.mjs';
import { scopeSignature } from '../public/sprint-policy.js';

function storage(){
  const pages=[];
  return {
    pages,
    query:async()=>pages,
    create:async(db,properties)=>{pages.push({id:`p${pages.length}`,properties});return pages.at(-1);},
  };
}
function dashboard(){
  return {
    projects:[
      {name:'A',notionId:'a',currentSprints:['Sprint3'],sprintRequired:true,specs:[]},
      {name:'B',notionId:'b',currentSprints:['스프린트3'],sprintRequired:true,specs:[]},
    ],
    workItems:[
      {id:'x',project:'A',sprint:'Sprint4',status:'진행 중'},
      {id:'y',project:'B',sprint:'Sprint5',status:'진행 중'},
    ],
    sprintScope:{mode:'selected',input:'3',sprints:['Sprint3'],configured:true,signature:scopeSignature({mode:'selected',sprints:['Sprint3']})},
    ai:{analysisStatus:'success',generatedAt:'2026-09-07T10:00:00+09:00'},
    sourceHealth:{status:'ok',sources:[{id:'agent-analysis',status:'ok',analysisStatus:'success'}]},
  };
}
async function revision(s){ return (await readSprintSettings({databaseId:'db',query:s.query})).revision; }

test('First save is append-only, global and read back',async()=>{
  const s=storage();
  const r=await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'3,4',expectedRevision:await revision(s),...s,uuid:()=> 'r1'});
  assert.equal(s.pages.length,1);
  assert.equal(r.settings.setting.input,'3,4');
  assert.deepEqual(r.settings.setting.sprints,['Sprint3','Sprint4']);
  assert.equal((await readSprintSettings({databaseId:'db',query:s.query})).setting.revision,'r1');
});

test('Stale editor gets conflict without another write',async()=>{
  const s=storage(); const initial=await revision(s);
  await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'4',expectedRevision:initial,...s,uuid:()=> 'r1'});
  await assert.rejects(()=>saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'3',expectedRevision:initial,...s}),e=>e.statusCode===409);
  assert.equal(s.pages.length,1);
});

test('Blank saved input remains explicit unset and never falls back',async()=>{
  const s=storage();
  const {settings}=await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'',expectedRevision:await revision(s),...s,uuid:()=> 'r1'});
  const applied=applySavedSprintSettings(dashboard().projects,settings,{workItems:dashboard().workItems});
  assert.equal(applied.scope.mode,'unset');
  assert.deepEqual(applied.projects[0].currentSprints,[]);
  assert.equal(applied.projects[0].sprintSettingSource,'dashboard');
});

test('History retains previous global input',async()=>{
  const s=storage(); const initial=await revision(s);
  await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'4',expectedRevision:initial,now:'2026-09-07T10:00:00Z',...s,uuid:()=> 'r1'});
  const {settings}=await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'3,5',expectedRevision:'r1',now:'2026-09-07T10:01:00Z',...s,uuid:()=> 'r2'});
  assert.equal(s.pages.length,2);
  assert.equal(settings.setting.revision,'r2');
  assert.equal(settings.history[0].previousInput,'4');
});

test('New sprint and ALL can be saved without pre-created options',async()=>{
  const s=storage(); const initial=await revision(s);
  await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'999',expectedRevision:initial,...s,uuid:()=> 'r1'});
  const {settings}=await saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'전체',expectedRevision:'r1',...s,uuid:()=> 'r2'});
  assert.equal(settings.setting.mode,'all');
  assert.equal(settings.setting.input,'전체');
});

test('Malformed input is rejected without write',async()=>{
  const s=storage(); const initial=await revision(s);
  await assert.rejects(()=>saveSprintSettings({databaseId:'db',dashboard:dashboard(),input:'Sprint3',expectedRevision:initial,...s}),/숫자를 쉼표/);
  assert.equal(s.pages.length,0);
});

test('Malformed configuration fails rather than silently reverting',async()=>{
  await assert.rejects(()=>readSprintSettings({query:async()=>{throw Error('network');}}));
  await assert.rejects(()=>readSprintSettings({query:async()=>[{properties:{payload:{rich_text:[{text:{content:'broken'}}]}}}]}),e=>e.statusCode===503);
});

test('Write requires a separate strong administrator token',()=>{
  const token='a'.repeat(32);
  assert.equal(settingsWriteAuthorized({headers:{}},token),false);
  assert.equal(settingsWriteAuthorized({headers:{authorization:'Bearer wrong'}},token),false);
  assert.equal(settingsWriteAuthorized({headers:{authorization:`Bearer ${token}`}},token),true);
  assert.equal(settingsWriteAuthorized({headers:{authorization:'Bearer tiny'}},'tiny'),false);
});

test('Reject cross-origin browser settings writes',()=>{
  assert.equal(settingsOriginAllowed({headers:{origin:'https://evil.example',host:'dashboard.example'}}),false);
  assert.equal(settingsOriginAllowed({headers:{origin:'https://dashboard.example',host:'dashboard.example'}}),true);
});

test('Limit parsed and streamed request bodies',async()=>{
  await assert.rejects(()=>readSettingsBody({body:{x:'x'.repeat(17000)}}),e=>e.statusCode===413);
  await assert.rejects(()=>readSettingsBody(Readable.from(['x'.repeat(17000)])),e=>e.statusCode===413);
  assert.deepEqual(await readSettingsBody({body:'{"a":1}'}),{a:1});
});

test('Scope changes invalidate analysis and trust together',()=>{
  const d=dashboard();
  const settings={revision:'r',history:[],legacyRecordCount:0,setting:{kind:'MOLIP_GLOBAL_SPRINT_SETTINGS_V2',mode:'selected',input:'4',sprints:['Sprint4'],revision:'r',changedAt:'2026-09-07T11:00:00Z'}};
  const v=decorateSprintDashboard(d,settings);
  assert.equal(v.ai.analysisStatus,'stale');
  assert.equal(v.sourceHealth.sources[0].analysisStatus,'stale');
  assert.equal(v.sprintSettings.pendingInput,true);
  assert.equal(d.ai.analysisStatus,'success');
});

test('Equivalent global scope does not unnecessarily invalidate analysis',()=>{
  const settings={revision:'r',history:[],legacyRecordCount:0,setting:{kind:'MOLIP_GLOBAL_SPRINT_SETTINGS_V2',mode:'selected',input:'3',sprints:['스프린트3'],revision:'r',changedAt:'2026-09-07T11:00:00Z'}};
  const r=decorateSprintDashboard(dashboard(),settings);
  assert.equal(r.sprintSettings.pendingInput,false);
  assert.equal(r.ai.analysisStatus,'success');
});

test('Fresh collection does not relabel an older same-day analysis as current', () => {
  const d={projects:[],workItems:[],sprintScope:{mode:'unset',input:'',sprints:[],configured:false,signature:scopeSignature({mode:'unset',sprints:[]})},generatedAt:'2026-09-07T04:00:00Z',agentHandoff:{generatedAt:'2026-09-07T04:00:00Z'},ai:{analysisStatus:'success',generatedAt:'2026-09-07T00:00:00Z'}};
  const output=decorateSprintDashboard(d,{setting:null,revision:'r',history:[],legacyRecordCount:0});
  assert.equal(output.sprintSettings.pendingInput,false);
  assert.equal(output.sprintSettings.pendingAnalysis,true);
  assert.equal(output.ai.analysisStatus,'stale');
});
