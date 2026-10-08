import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalRows } from '../public/approval-presentation.js';

test('proposal summary uses exact pending arguments and historical dataset snapshot without mutating arguments', () => {
  const args = { action:'class_room', references:[{role:'subject',dataset_id:'classes',record_id:'c01',source_id:'ds-classes-abcdef'}, {role:'target',dataset_id:'rooms',record_id:'R4',source_id:'ds-rooms-123456'}],changes:{room:'B202'},reason:'Requested move.' };
  const before=JSON.stringify(args), task={data:{datasets:[{id:'classes',version:'class-snapshot'},{id:'rooms',version:'room-snapshot'}]}};
  const rows=approvalRows({tool:'create_proposal',result_kind:'proposal',arguments:args},task);
  assert.equal(JSON.stringify(args),before);
  assert.ok(rows.some(([label,value])=>label==='Action' && value==='class_room'));
  assert.ok(rows.some(([label,value])=>label==='Subject' && value.includes('c01') && value.includes('ds-classes-abcdef') && value.includes('class-snapshot')));
  assert.ok(rows.some(([label,value])=>label==='Target' && value.includes('R4')));
  assert.ok(rows.some(([label,value])=>label==='Changes' && value==='{"room":"B202"}'));
  assert.ok(rows.some(([label,value])=>label==='Reason' && value==='Requested move.'));
});
test('unknown tool or proposal fields remain visible as literal raw values, including untrusted markup', () => {
  const pending={tool:'future_write',arguments:{subject:'<img onerror=x>',formula:'not executable',count:0}};
  assert.deepEqual(approvalRows(pending,{}), [['subject','<img onerror=x>'],['formula','not executable'],['count','0']]);
  const proposal={tool:'create_proposal',result_kind:'proposal',arguments:{action:'ticket_status',references:[],changes:{status:'closed'},reason:'why',new_field:'<script>fake</script>'}};
  assert.ok(approvalRows(proposal,{}).some(([k,v])=>k==='new_field'&&v==='<script>fake</script>'));
});
test('draft title, content and source IDs are presented in full; snapshot is never guessed when metadata is absent', () => {
  const rows=approvalRows({tool:'save_draft',arguments:{title:'Note',content:'Long content',source_ids:['http-status']}},{});
  assert.deepEqual(rows,[['title','Note'],['content','Long content'],['source_ids','["http-status"]']]);
  const proposal={tool:'create_proposal',result_kind:'proposal',arguments:{action:'ticket_status',references:[{role:'subject',dataset_id:'tickets',record_id:'T2',source_id:'exact-source'}],changes:{status:'closed'},reason:'why'}};
  assert.ok(approvalRows(proposal,{}).some(([k,v])=>k==='Subject'&&v.includes('snapshot unavailable')));
});
