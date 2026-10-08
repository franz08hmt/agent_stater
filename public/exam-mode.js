const KEY = 'agent-studio.ui-mode';
const valid = (value) => ['standard', 'exam'].includes(value);
export function readModePreference(storage) {
  try { const value = storage.getItem(KEY); return valid(value) ? value : 'standard'; } catch { return 'standard'; }
}
export function rememberMode(storage, mode) {
  if (!valid(mode)) return;
  try { storage.setItem(KEY, mode); } catch { /* Layout still works without storage. */ }
}
export function setupExamMode(document, storage, onChange) {
  const button = document.getElementById('exam-mode');
  const current = () => document.documentElement.dataset.mode;
  function apply(mode) {
    document.documentElement.dataset.mode = mode;
    document.getElementById('app-header')?.setAttribute('aria-labelledby', mode === 'exam' ? 'exam-title' : 'page-title');
    button.setAttribute('aria-pressed', String(mode === 'exam'));
    document.getElementById('mode-state').textContent = mode === 'exam' ? 'Exam' : 'Standard';
    onChange();
  }
  apply(readModePreference(storage));
  button.addEventListener('click', () => { const mode = current() === 'exam' ? 'standard' : 'exam'; rememberMode(storage, mode); apply(mode); });
  return { current };
}
export function modeContext(run, selection) {
  if (run) return `Viewing: ${run.configuration?.task.title ?? run.task_id ?? 'Legacy task'} · ${run.configuration?.model_profile.label ?? 'Legacy profile'} · ${run.model ? `${run.model.is_mock ? 'Mock' : 'Live'} ${run.model.name}` : 'Model unavailable'} · ${run.status.replaceAll('_', ' ')}`;
  if (!selection) return 'Loading backend configuration…';
  return `Next run: ${selection.task.title} · ${selection.profile.is_mock ? 'Mock' : 'Live'} ${selection.profile.name} · ${selection.profile.status}`;
}
