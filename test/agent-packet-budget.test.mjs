import assert from 'node:assert/strict';
import test from 'node:test';
import {fitRemoteEvidenceBudget, REMOTE_PACKET_LIMIT} from '../lib/agent-packet-budget.mjs';
import {buildAgentInputPacket} from '../lib/agent-handoff.mjs';
import {enrichAgentPacketWithProjectOperations} from '../lib/agent-project-operations.mjs';

function fixture() {
 return {rules:{deltas:[{field:'task.status',from:'준비',to:'진행'}]}, outputSchema:{type:'object',required:['projects'],properties:{projects:{type:'array',description:'설명'.repeat(1000)}}}, projects:[{
  name:'A', ruleAuditItems:Array.from({length:500},()=>[0,1,0,0,3,0,[1]]), specCatalog:Array.from({length:90},(_,i)=>['s'+i,'상위 업무 '+i,'Sprint3','진행 중',2,30,0]),
  sourceEvidence:Array.from({length:270},(_,i)=>['s'+(i%90),i%2?'slack':'meeting','2026-09-23','회의 제목','근거 '.repeat(150),'https://example.test/'+i,null,'recent_execution']),
  previousSummary:'이전 요약 '.repeat(1000),
 }]};
}
test('budget preserves rule rows, spec IDs and deltas and reports evidence loss',()=>{
 const p=fixture(); const original=structuredClone(p);fitRemoteEvidenceBudget(p);
 assert.ok(JSON.stringify(p).length<=REMOTE_PACKET_LIMIT);
 assert.deepEqual(p.rules,original.rules);assert.deepEqual(p.projects[0].ruleAuditItems,original.projects[0].ruleAuditItems);assert.deepEqual(p.projects[0].specCatalog,original.projects[0].specCatalog);
 const c=p.projects[0].evidenceCoverage;assert.equal(c.originalRows,270);assert.equal(c.retainedRows,p.projects[0].sourceEvidence.length);assert.equal(c.omittedRows,270-c.retainedRows);assert.ok(c.excerptCharsRemoved>0);
 assert.equal(new Set(p.projects[0].sourceEvidence.map(r=>r[0])).size,90);
 const current=JSON.stringify(p);fitRemoteEvidenceBudget(p);assert.equal(JSON.stringify(p),current);
});
test('irreducible mandatory facts fail instead of silently dropping task or change rows',()=>{
 const p=fixture();p.rules.deltas=[{fact:'x'.repeat(REMOTE_PACKET_LIMIT)}];const before=structuredClone(p.rules);
 assert.throws(()=>fitRemoteEvidenceBudget(p),/원격 규칙 입력 예산 초과/);assert.deepEqual(p.rules,before);
});
test('schema compaction preserves a field named description and all validation constraints',()=>{
 const p=fixture();p.outputSchema.properties.description={type:'string',minLength:1,description:'field help'};
 p.outputSchema.required.push('description');fitRemoteEvidenceBudget(p);
 assert.deepEqual(p.outputSchema.properties.description,{type:'string',minLength:1});
 assert.deepEqual(p.outputSchema.required,['projects','description']);
 assert.equal(p.outputSchema.properties.projects.type,'array');
 assert.ok(p.packetBudget.schemaDescriptionCharsRemoved>0);
});
test('project-wide meeting handoff survives without a matching active spec and never mutates dashboard',()=>{
 const evidence={source:'meeting',timestamp:'2026-09-23',title:'A 빌드 리뷰',excerpt:'빌드1 전달 완료. 빌드2 다음 QA 준비.',url:'https://example.test/meeting',evidenceRole:'project_operation'};
 const d={generatedAt:'2026-09-23T00:00:00Z',projects:[{name:'A',specs:[],meetings:[{title:evidence.title,date:evidence.timestamp,url:evidence.url,contentChecked:true}],projectOperations:{evidence:[evidence],latestBuild:{...evidence},latestQa:{...evidence}}}],workItems:[],metrics:{},validationIssues:[],deltas:[]};
 const before=structuredClone(d);const p=enrichAgentPacketWithProjectOperations(buildAgentInputPacket(d),d);fitRemoteEvidenceBudget(p);
 assert.deepEqual(d,before);assert.equal(p.projects[0].meetingReferences.length,1);assert.ok(p.projects[0].sourceEvidence.some(r=>r[0]===null&&r[1]==='meeting'));
 const c=p.projects[0].evidenceCoverage;assert.equal(c.omittedRows,0);assert.equal(c.originalRows,c.retainedRows);
});
