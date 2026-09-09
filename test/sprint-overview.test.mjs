import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSprintOverview } from '../public/sprint-overview.js';

const kpis=metrics=>`<div class="kpis">${Object.entries(metrics).map(([key,value])=>`<button data-briefing-detail="${key}">${value}</button>`).join('')}</div>`;
const data={
  projects:[{name:'A',notionId:'a',currentSprints:['Sprint3'],sprintRequired:true,specs:[]}],
  workItems:[{id:'x',project:'A',sprint:'Sprint4',status:'진행 중',title:'Test'}],
  sprintScope:{mode:'selected',input:'3',sprints:['Sprint3'],configured:true,signature:'x'},
  sprintSettings:{writable:true,setting:null,scope:{mode:'selected',input:'3',sprints:['Sprint3'],configured:true},history:[],revision:'initial',pendingInput:false,pendingAnalysis:false},
};
const state={sprintInput:null,filters:{},detail:null,message:'',saving:false};

test('Section uses one shared sprint text input with gray usage guide',()=>{
  const html=renderSprintOverview(data,state,kpis);
  assert.ok(html.includes('4. 스프린트별 업무 현황'));
  assert.equal((html.match(/data-scope-sprint/g)||[]).length,1);
  assert.ok(html.includes('예: 3,4,5 · 전체'));
  assert.ok(!html.includes('type="checkbox"'));
});

test('Preview copy explicitly separates unsaved scope from stored analysis',()=>{
  const code=fs.readFileSync(new URL('../public/sprint-overview.js',import.meta.url),'utf8');
  assert.ok(code.includes('조회 미리보기'));
  assert.ok(code.includes('저장해야 팀 공통 기준'));
});

test('Blank saved scope is shown as unconfigured rather than zero-result success',()=>{
  const blank={...data,sprintScope:{mode:'unset',input:'',sprints:[],configured:false,signature:'u'},sprintSettings:{...data.sprintSettings,scope:{mode:'unset',input:'',sprints:[],configured:false}}};
  const html=renderSprintOverview(blank,state,kpis);
  assert.ok(html.includes('미입력 상태'));
  assert.ok(html.includes('미계산'));
});

test('ALL saved scope renders as an explicit input mode',()=>{
  const all={...data,sprintScope:{mode:'all',input:'전체',sprints:['Sprint3','Sprint4'],configured:true,signature:'a'},sprintSettings:{...data.sprintSettings,scope:{mode:'all',input:'전체',sprints:['Sprint3','Sprint4'],configured:true}}};
  const html=renderSprintOverview(all,state,kpis);
  assert.ok(!html.includes('입력 확인 필요'));
  assert.ok(html.includes('value="전체"'));
});

test('Disable save without server administrator capability',()=>{
  const html=renderSprintOverview({...data,sprintSettings:{...data.sprintSettings,writable:false}}, state, kpis);
  assert.ok(html.includes('data-scope-save disabled'));
});

test('Untrusted project values are escaped',()=>{
  const html=renderSprintOverview({...data,projects:[{...data.projects[0],name:'<img src=x onerror=alert(1)>'}]},state,kpis);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('Admin key is masked and never persisted',()=>{
  const code=fs.readFileSync(new URL('../public/sprint-overview.js',import.meta.url),'utf8');
  assert.ok(code.includes('type="password"'));
  assert.doesNotMatch(code,/localStorage|sessionStorage/);
});

test('Briefing source contract keeps AI, changes, project status, then sprint overview',()=>{
  const presenter=fs.readFileSync(new URL('../public/dashboard-presenters.js',import.meta.url),'utf8');
  const sprint=fs.readFileSync(new URL('../public/sprint-overview.js',import.meta.url),'utf8');
  assert.match(presenter,/1\. AI 통합 브리핑/);
  assert.match(presenter,/2\. 어제와 달라진 것/);
  assert.match(presenter,/3\. 프로젝트 현황/);
  assert.match(sprint,/4\. 스프린트별 업무 현황/);
});

test('Backend connects shared settings without changing raw metrics',()=>{
  const api=fs.readFileSync(new URL('../api/app.mjs',import.meta.url),'utf8'),collect=fs.readFileSync(new URL('../collect.mjs',import.meta.url),'utf8');
  assert.ok(api.includes('settingsWriteAuthorized'));
  assert.ok(api.includes('input: body.input'));
  assert.ok(collect.includes('applySavedSprintSettings'));
  assert.ok(collect.includes('agentInput.rules.briefingMetrics = workOverview.metrics'));
  assert.ok(!collect.includes('agentInput.rules.metrics = workOverview.metrics'));
});
