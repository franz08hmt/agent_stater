const VIEW_BY_HASH = {
  '#configuration': 'agent',
  '#dialogue': 'dialogue',
  '#drafts-title': 'drafts',
};

const PANELS_BY_VIEW = {
  overview: ['agent-profile', 'configuration', 'dialogue'],
  agent: ['configuration'],
  dialogue: ['dialogue'],
  drafts: ['agent-profile'],
};

const ACTIVE_HASH_BY_VIEW = {
  overview: '#agent-profile',
  agent: '#configuration',
  dialogue: '#dialogue',
  drafts: '#drafts-title',
};

const HEADING_BY_VIEW = {
  overview: 'profile-title',
  agent: 'configuration-title',
  dialogue: 'dialogue-title',
  drafts: 'drafts-title',
};

export function viewFromHash(hash) {
  return VIEW_BY_HASH[hash] || 'overview';
}

export function visiblePanels(view, mode = 'standard') {
  if (mode === 'exam' && view !== 'drafts') return ['configuration', 'dialogue'];
  return PANELS_BY_VIEW[view] || PANELS_BY_VIEW.overview;
}

export function applyWorkspaceView(document, hash, mode = 'standard') {
  const view = viewFromHash(hash);
  const visible = new Set(visiblePanels(view, mode));
  document.getElementById('workspace').dataset.view = mode === 'exam' && view !== 'drafts' ? 'exam' : view;
  for (const id of PANELS_BY_VIEW.overview) {
    document.getElementById(id).hidden = !visible.has(id);
  }
  for (const link of document.querySelectorAll('.nav-link')) {
    const active = link.getAttribute('href') === ACTIVE_HASH_BY_VIEW[view];
    link.classList.toggle('is-current', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  return mode === 'exam' && view === 'overview' ? 'configuration-title' : HEADING_BY_VIEW[view];
}
