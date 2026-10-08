import test from 'node:test';
import assert from 'node:assert/strict';
import { readModePreference, rememberMode, setupExamMode, modeContext } from '../public/exam-mode.js';
import { applyWorkspaceView, visiblePanels } from '../public/workspace-view.js';

test('mode preference stores only a defined enum under its own key; unavailable/corrupt storage falls back to standard', () => {
  const values = new Map([['agent-studio.viewed-run', 'run_history']]);
  const storage = { getItem: (key) => values.get(key), setItem: (k,v) => values.set(k,v) };
  assert.equal(readModePreference(storage), 'standard'); rememberMode(storage, 'exam');
  assert.equal(readModePreference(storage), 'exam'); assert.deepEqual([...values], [['agent-studio.viewed-run','run_history'], ['agent-studio.ui-mode','exam']]);
  rememberMode(storage, 'goal or secret'); assert.equal(readModePreference(storage), 'exam');
  values.set('agent-studio.ui-mode', '{"goal":"do not load"}'); assert.equal(readModePreference(storage), 'standard');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readModePreference(blocked), 'standard'); assert.doesNotThrow(() => rememberMode(blocked, 'exam'));
});
test('mode toggle updates DOM semantics and preference without navigating, changing selection, or starting any activity', () => {
  const nodes = Object.fromEntries(['exam-mode','mode-state'].map((id) => [id, { textContent: '', attrs: {}, setAttribute(k,v) { this.attrs[k]=v; }, addEventListener(_e,fn) { this.click=fn; } }]));
  const document = { documentElement: { dataset: {} }, getElementById: (id) => nodes[id] };
  const storage = { getItem: () => 'exam', setItem(k,v) { this.saved=[k,v]; } }; let changes=0;
  const mode = setupExamMode(document, storage, () => changes++);
  assert.equal(mode.current(), 'exam'); assert.equal(nodes['exam-mode'].attrs['aria-pressed'], 'true');
  nodes['exam-mode'].click(); assert.equal(mode.current(), 'standard'); assert.equal(nodes['exam-mode'].attrs['aria-pressed'], 'false');
  assert.deepEqual(storage.saved, ['agent-studio.ui-mode','standard']); assert.equal(changes, 2);
});
test('Exam workspace visibility is semantic; saved records remains separate and hash chooses the focus heading', () => {
  for (const view of ['overview','agent','dialogue']) assert.deepEqual(visiblePanels(view, 'exam'), ['configuration','dialogue']);
  assert.deepEqual(visiblePanels('drafts','exam'), ['agent-profile']);
  const panels = Object.fromEntries(['workspace','agent-profile','configuration','dialogue'].map((id) => [id, { dataset: {}, hidden: false }]));
  const document = { getElementById: (id) => panels[id], querySelectorAll: () => [] };
  assert.equal(applyWorkspaceView(document, '#dialogue', 'exam'), 'dialogue-title');
  assert.equal(panels.workspace.dataset.view, 'exam'); assert.equal(panels.configuration.hidden,false); assert.equal(panels.dialogue.hidden,false); assert.equal(panels['agent-profile'].hidden,true);
  assert.equal(applyWorkspaceView(document, '#agent-profile', 'exam'), 'configuration-title');
  assert.equal(applyWorkspaceView(document, '#drafts-title', 'exam'), 'drafts-title'); assert.equal(panels.configuration.hidden,true);
  applyWorkspaceView(document, '#dialogue', 'standard'); assert.equal(panels.configuration.hidden,true);
});
test('header context uses the viewed run historical configuration even when next-run selection changes', () => {
  const selection = { task: {title:'Next task'}, profile: {name:'next', is_mock:false,status:'unavailable'} };
  const run = { configuration: {task:{title:'Saved task'},model_profile:{label:'Saved profile'}},model:{name:'saved',is_mock:true},status:'stopped' };
  assert.match(modeContext(run,selection), /Saved task.*Mock.*saved.*stopped/); assert.ok(!modeContext(run,selection).includes('Next task'));
  assert.match(modeContext(null,selection), /Next task.*Live.*unavailable/);
});
