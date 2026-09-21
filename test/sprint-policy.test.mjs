import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSprintOverview,
  classifySprint,
  normalizeSprint,
  uniqueSprints,
  scopeSignature,
  applyGlobalSprintScope,
  parseSprintInput,
  legacyGlobalSprintScope,
  sortIssuesOverdueFirst,
} from '../public/sprint-policy.js';

const guide = {type:'MISSING_BRANCH',category:'guide',severity:'error'};
const overdue = {type:'OVERDUE',category:'schedule',severity:'warning'};
function fixture(){
  const projects=[
    {name:'A',notionId:'a',currentSprints:['Sprint3'],sprintRequired:true,specs:[]},
    {name:'B',notionId:'b',currentSprints:['스프린트3'],sprintRequired:true,specs:[]},
    {name:'Ops',notionId:'o',sprintRequired:false,specs:[]},
  ];
  const task=(id,project,sprint,status,issues=[])=>({id,title:id,project,sprint,status,itemLevel:'child',issues,assignees:['Owner'],team:'개발'});
  const workItems=[
    task('a3','A','스프린트3','진행 중'),
    task('a4','A','Sprint4','진행 중',[guide]),
    task('a3-late','A','Sprint3','진행 중',[overdue,guide]),
    task('a3-ready','A','Sprint3','시작 전'),
    task('a2-late','A','Sprint2','진행 중',[overdue,guide]),
    task('a-none','A',null,'진행 중',[guide]),
    task('b3','B','Sprint3','진행 중',[guide]),
    task('b4','B','Sprint4','진행 중',[guide]),
    task('ops','Ops',null,'진행 중',[guide]),
    task('ops-ready','Ops',null,'시작 전'),
    task('closed','A','Sprint3','완료',[overdue]),
    task('pause','A','Sprint3','일시 정지',[guide]),
  ];
  return {projects,workItems,validationIssues:[],metrics:{guideViolationWorkItems:91}};
}

test('Equivalent labels normalize and deduplicate',()=>{
  assert.equal(normalizeSprint(' 스프린트 003 '),'sprint3');
  assert.equal(uniqueSprints(['Sprint3','스프린트3','Sprint4']).length,2);
});

test('Global input accepts numbers, duplicates, spaces and all',()=>{
  assert.deepEqual(parseSprintInput(' 3, 4,3,5 ').sprints,['Sprint3','Sprint4','Sprint5']);
  assert.equal(parseSprintInput('전체').mode,'all');
  assert.equal(parseSprintInput('').mode,'unset');
  assert.throws(()=>parseSprintInput('Sprint3'));
});

test('New sprint numbers do not need pre-created choices',()=>{
  assert.deepEqual(parseSprintInput('999').sprints,['Sprint999']);
});

for(const [value,selected,expected] of [
  ['Sprint3',['Sprint3','Sprint5'],'current'],
  ['Sprint5',['Sprint3','Sprint5'],'current'],
  ['Sprint4',['Sprint3','Sprint5'],'unknown'],
  ['Sprint2',['Sprint3','Sprint5'],'past'],
  ['Sprint6',['Sprint3','Sprint5'],'future'],
  ['Sprint3',[],'unknown'],
  [null,['Sprint3'],'unknown'],
]) test(`Relation ${value}/${selected}->${expected}`,()=>assert.equal(classifySprint(value,selected),expected));

test('Scoped guide KPI keeps overlapping guide issues visible',()=>{
  assert.deepEqual(buildSprintOverview(fixture()).metrics,{
    activeProjects:3,inProgressWorkItems:4,overdueWorkItems:1,guideViolationWorkItems:3,progressSetupRequiredItems:1,
  });
});

test('One global selection applies to every sprint-enabled project',()=>{
  const v=buildSprintOverview(fixture(),parseSprintInput('3,4'));
  assert.ok(v.workItems.some(i=>i.id==='a4'));
  assert.ok(v.workItems.some(i=>i.id==='b4'));
  assert.equal(v.metrics.guideViolationWorkItems,5);
});

test('Empty input is unset, not ALL',()=>{
  const v=buildSprintOverview(fixture(),parseSprintInput(''));
  assert.equal(v.scopeConfigured,false);
  assert.equal(v.workItems.length,0);
  assert.deepEqual(v.unconfiguredProjects,['A','B']);
});

test('ALL includes every assigned sprint but not missing sprint values',()=>{
  const v=buildSprintOverview(fixture(),parseSprintInput('전체'));
  assert.ok(v.workItems.some(i=>i.id==='a2-late'));
  assert.ok(v.workItems.some(i=>i.id==='a4'));
  assert.ok(!v.workItems.some(i=>i.id==='a-none'));
  assert.ok(v.unknownSprintItems.some(i=>i.id==='a-none'));
});

test('Overdue and guide remain independently discoverable while source data stays immutable',()=>{
  const d=fixture(); const original=JSON.stringify(d); const v=buildSprintOverview(d);
  assert.ok(v.overdueItems.some(i=>i.id==='a3-late'));
  assert.ok(v.guideViolationItems.some(i=>i.id==='a3-late'));
  assert.equal(v.overdueGuideOverlapItems.length,1);
  assert.equal(v.overdueItems[0].issues.length,2);
  assert.equal(JSON.stringify(d),original);
});

test('Guide count counts tasks rather than failed rules',()=>{
  const d=fixture(); d.workItems.find(i=>i.id==='b3').issues.push({...guide,type:'MISSING_PRIORITY'});
  assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,3);
});

test('Outside overdue and missing sprint remain discoverable',()=>{
  const v=buildSprintOverview(fixture());
  assert.deepEqual(v.outsideOverdueItems.map(i=>i.id),['a2-late']);
  assert.ok(v.unknownSprintItems.some(i=>i.id==='a-none'));
});

test('No-sprint project is active but not sprint preparation',()=>{
  const v=buildSprintOverview(fixture());
  assert.ok(v.workItems.some(i=>i.id==='ops-ready'));
  assert.ok(!v.progressSetupItems.some(i=>i.id==='ops-ready'));
});

test('Closed tasks and children of closed parents are excluded',()=>{
  const d=fixture(); d.projects[0].specs.push({id:'closed-parent',status:'중단'});
  d.workItems.push({id:'hidden-child',project:'A',sprint:'Sprint3',status:'진행 중',specId:'closed-parent'});
  assert.ok(!buildSprintOverview(d).workItems.some(i=>['closed','pause','hidden-child'].includes(i.id)));
});

test('Parent guide issues are visible without changing child-only execution KPIs',()=>{
  const d=fixture(); d.workItems.push({id:'parent',title:'Parent',itemLevel:'parent',project:'A',sprint:'Sprint3',status:'진행 중',issues:[guide]});
  const v=buildSprintOverview(d);
  assert.equal(v.metrics.guideViolationWorkItems,4);
  assert.equal(v.guideBreakdown.parent,1);
  assert.equal(v.guideBreakdown.child,3);
  assert.equal(v.metrics.inProgressWorkItems,4);
});

test('Compact snapshot issue links are restored',()=>{
  const d=fixture(); d.workItems.find(i=>i.id==='b3').issues=[]; d.validationIssues=[{...guide,workItemId:'b3'}];
  assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,3);
});

test('Filters affect lists and counters consistently',()=>{
  const v=buildSprintOverview(fixture(),parseSprintInput('3'),{project:'A'});
  assert.equal(v.metrics.activeProjects,1);
  assert.equal(v.metrics.inProgressWorkItems,2);
  assert.equal(v.metrics.inProgressWorkItems,v.runningItems.length);
});

test('Global scope identity ignores order and equivalent spelling',()=>{
  assert.equal(scopeSignature({mode:'selected',sprints:['Sprint4','스프린트3']}),scopeSignature({mode:'selected',sprints:['Sprint3','Sprint4']}));
  const applied=applyGlobalSprintScope(fixture().projects,{sprints:['Sprint7']});
  assert.deepEqual(applied.filter(p=>p.sprintRequired!==false).map(p=>p.currentSprints),[['Sprint7'],['Sprint7']]);
});

test('Legacy project values migrate only when all sprint projects agree',()=>{
  assert.equal(legacyGlobalSprintScope(fixture().projects).input,'3');
  const d=fixture(); d.projects[1].currentSprints=['Sprint8'];
  assert.equal(legacyGlobalSprintScope(d.projects).mode,'unset');
});

test('Overdue issue is primary despite guide error severity',()=>assert.equal(sortIssuesOverdueFirst([guide,overdue])[0].type,'OVERDUE'));

test('No tasks has zero counts without invented scope',()=>{
  assert.deepEqual(Object.values(buildSprintOverview({projects:[],workItems:[]}).metrics),[0,0,0,0,0]);
});


test('Guide taxonomy matches 확인필요 even when raw category is missing',()=>{
  const d=fixture(); d.workItems.find(i=>i.id==='b3').issues=[{type:'MISSING_BRANCH',severity:'error',message:'missing'}];
  assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,3);
});

test('Selected scope explains guide items outside and without a classifiable sprint',()=>{
  const v=buildSprintOverview(fixture());
  assert.equal(v.outsideGuideViolationItems.length,3);
  assert.ok(v.unknownGuideViolationItems.some(i=>i.id==='a-none'));
});
