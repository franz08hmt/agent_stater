import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFromHash, visiblePanels, applyWorkspaceView } from '../public/workspace-view.js';

test('workspace links resolve to the intended view', () => {
  assert.equal(viewFromHash(''), 'overview');
  assert.equal(viewFromHash('#workspace'), 'overview');
  assert.equal(viewFromHash('#agent-profile'), 'overview');
  assert.equal(viewFromHash('#configuration'), 'agent');
  assert.equal(viewFromHash('#dialogue'), 'dialogue');
  assert.equal(viewFromHash('#drafts-title'), 'drafts');
  assert.equal(viewFromHash('#unknown'), 'overview');
});

test('focused views expose only their relevant panel', () => {
  assert.deepEqual(visiblePanels('overview'), ['agent-profile', 'configuration', 'dialogue']);
  assert.deepEqual(visiblePanels('agent'), ['configuration']);
  assert.deepEqual(visiblePanels('dialogue'), ['dialogue']);
  assert.deepEqual(visiblePanels('drafts'), ['agent-profile']);
});

test('navigation marks the active link and hides unrelated panels', () => {
  const panels = Object.fromEntries(['agent-profile', 'configuration', 'dialogue'].map((id) => [id, { hidden: false }]));
  const workspace = { dataset: {} };
  const links = ['#agent-profile', '#configuration', '#dialogue', '#drafts-title'].map((href) => {
    const attributes = new Map([['href', href]]);
    const classes = new Set();
    return {
      getAttribute: (name) => attributes.get(name),
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
    };
  });
  const document = {
    getElementById: (id) => id === 'workspace' ? workspace : panels[id],
    querySelectorAll: () => links,
  };

  assert.equal(applyWorkspaceView(document, '#dialogue'), 'dialogue-title');
  assert.equal(workspace.dataset.view, 'dialogue');
  assert.deepEqual(Object.values(panels).map((panel) => panel.hidden), [true, true, false]);
  assert.equal(links[2].getAttribute('aria-current'), 'location');
  assert.equal(links[2].classList.contains('is-current'), true);
  assert.equal(links[1].getAttribute('aria-current'), undefined);

  assert.equal(applyWorkspaceView(document, '#agent-profile'), 'profile-title');
  assert.deepEqual(Object.values(panels).map((panel) => panel.hidden), [false, false, false]);
  assert.equal(links[2].classList.contains('is-current'), false);
  assert.equal(links[0].classList.contains('is-current'), true);
});
