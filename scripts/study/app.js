// Read-only study UI. No fetch, model, agent API or third-party runtime.
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('study-data').textContent);
  const byId = id => document.getElementById(id);
  const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
  const key = 'agent-oral-study.learned.v1', validIds = new Set(data.questions.map(q => q.id));
  let known = new Set(), mode = 'read', current = '', pool = [], selectedChapter = 'all';
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) known = new Set(saved.filter(id => validIds.has(id)));
  } catch { /* Missing/corrupt/storage-disabled state never prevents reading. */ }
  const cards = new Map(data.questions.map(q => [q.id, byId(q.id)]));
  function save() {
    try { localStorage.setItem(key, JSON.stringify([...known])); byId('storage-note').textContent = 'Tiến độ lưu trên trình duyệt này; không đồng bộ thiết bị.'; }
    catch { byId('storage-note').textContent = 'Trình duyệt không cho lưu tiến độ. Vẫn học được trong phiên này.'; }
  }
  function progress() {
    byId('progress').value = known.size;
    byId('progress-label').textContent = `${known.size} / ${data.questions.length} câu đã nắm`;
    for (const [id, card] of cards) {
      card.dataset.known = String(known.has(id));
      const button = card.querySelector('.mark');
      button.setAttribute('aria-pressed', String(known.has(id)));
      button.textContent = known.has(id) ? '✓ Đã nắm · bấm để bỏ dấu' : 'Đánh dấu đã nắm';
    }
  }
  function updateQuiz() {
    if (!pool.length) return;
    if (!pool.some(q => q.id === current)) current = pool[0].id;
    const question = pool.find(q => q.id === current), index = pool.indexOf(question);
    byId('quiz-position').textContent = `${index + 1} / ${pool.length} · ${question.label} · ${data.chapters[question.chapter].title}`;
    byId('quiz-question').textContent = question.title;
    // This HTML is generated from escaped Markdown, never arbitrary provider output.
    byId('quiz-answer').innerHTML = cards.get(current).querySelector('.answer').innerHTML;
    byId('quiz-answer').hidden = true; byId('quiz-assess').hidden = true;
    byId('reveal').hidden = false;
  }
  function filter() {
    const term = normalize(byId('search').value.trim()), essential = byId('essential').checked, unlearned = byId('unlearned').checked;
    pool = data.questions.filter(q => (selectedChapter === 'all' || String(q.chapter) === selectedChapter)
      && (!essential || q.essential) && (!unlearned || !known.has(q.id)) && (!term || q.search.includes(term)));
    const matched = new Set(pool.map(q => q.id));
    for (const [id, card] of cards) card.hidden = !matched.has(id);
    let notesVisible = false;
    for (let i = 0; i < data.chapters.length; i++) {
      const chapter = data.chapters[i], element = byId(chapter.id);
      const hasNotes = !!chapter.intro.trim() && !term && !essential && !unlearned && (selectedChapter === 'all' || String(i) === selectedChapter);
      element.hidden = !chapter.questions.some(id => matched.has(id)) && !hasNotes;
      notesVisible ||= hasNotes;
    }
    byId('empty').hidden = pool.length > 0 || (mode === 'read' && notesVisible);
    byId('result-count').textContent = `${pool.length} / ${data.questions.length} câu phù hợp${essential ? ' · trọng tâm' : ''}${unlearned ? ' · chưa nắm' : ''}`;
    byId('read-view').hidden = mode !== 'read';
    byId('quiz-view').hidden = mode !== 'quiz' || !pool.length;
    for (const link of document.querySelectorAll('[data-chapter]')) {
      if (link.dataset.chapter === selectedChapter) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    updateQuiz();
  }
  function changeMode(next) {
    mode = next;
    byId('read-mode').setAttribute('aria-pressed', String(mode === 'read'));
    byId('quiz-mode').setAttribute('aria-pressed', String(mode === 'quiz'));
    filter();
    if (mode === 'quiz' && pool.length) byId('quiz-title').focus();
  }
  function mark(id, value) {
    value ? known.add(id) : known.delete(id); save(); progress(); filter();
  }
  byId('filters').addEventListener('submit', event => event.preventDefault());
  for (const id of ['search', 'essential', 'unlearned']) byId(id).addEventListener(id === 'search' ? 'input' : 'change', filter);
  byId('chapter-select').addEventListener('change', event => { selectedChapter = event.target.value; filter(); });
  byId('chapter-nav').addEventListener('click', event => {
    const link = event.target.closest('[data-chapter]'); if (!link) return;
    event.preventDefault(); selectedChapter = link.dataset.chapter; byId('chapter-select').value = selectedChapter; filter();
    byId('search').focus();
  });
  byId('read-mode').addEventListener('click', () => changeMode('read'));
  byId('quiz-mode').addEventListener('click', () => changeMode('quiz'));
  byId('reveal').addEventListener('click', () => {
    byId('quiz-answer').hidden = false; byId('quiz-assess').hidden = false; byId('reveal').hidden = true;
    byId('quiz-known').focus();
  });
  function move(offset) {
    if (!pool.length) return;
    const index = pool.findIndex(q => q.id === current);
    current = pool[(index + offset + pool.length) % pool.length].id; updateQuiz();
  }
  byId('previous').addEventListener('click', () => move(-1));
  byId('next').addEventListener('click', () => move(1));
  byId('random').addEventListener('click', () => {
    if (pool.length > 1) move(1 + Math.floor(Math.random() * (pool.length - 1))); else updateQuiz();
  });
  function assess(value) {
    const nextId = pool.length ? pool[(pool.findIndex(q => q.id === current) + 1) % pool.length].id : '';
    mark(current, value);
    if (pool.some(q => q.id === nextId)) current = nextId;
    updateQuiz(); if (pool.length) byId('reveal').focus();
  }
  byId('quiz-known').addEventListener('click', () => assess(true));
  byId('quiz-again').addEventListener('click', () => assess(false));
  document.addEventListener('click', event => {
    const markButton = event.target.closest('[data-mark]');
    if (markButton) mark(markButton.dataset.mark, !known.has(markButton.dataset.mark));
    const link = event.target.closest('[data-resource]');
    if (link) {
      byId('source-title').textContent = link.dataset.resource;
      byId('source-code').textContent = data.resources[link.dataset.resource] ?? 'Đây là thư mục hoặc tài nguyên chưa đóng gói trong bản học. Mở đường dẫn này trong project trên PC để đối chiếu. Không có request mạng được gửi.';
      byId('source-dialog').showModal();
    }
  });
  byId('close-source').addEventListener('click', () => byId('source-dialog').close());
  byId('reset').addEventListener('click', () => byId('reset-dialog').showModal());
  byId('cancel-reset').addEventListener('click', () => byId('reset-dialog').close());
  byId('confirm-reset').addEventListener('click', () => { known.clear(); save(); progress(); filter(); byId('reset-dialog').close(); });
  let printState = [];
  window.addEventListener('beforeprint', () => { printState = [...document.querySelectorAll('.question')].map(e => [e, e.open]); for (const [e] of printState) e.open = true; });
  window.addEventListener('afterprint', () => { for (const [e, open] of printState) e.open = open; });
  byId('print').addEventListener('click', () => window.print());
  byId('storage-note').textContent = 'Tiến độ tự học chỉ lưu trên trình duyệt này. Có thể học khi không cho phép lưu.';
  progress(); filter();
})();
