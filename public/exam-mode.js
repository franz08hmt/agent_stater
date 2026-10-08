import { t, currentLocale } from './i18n.js';
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
    document.getElementById('mode-state').textContent = t(mode === 'exam' ? 'Exam' : 'Standard');
    onChange();
  }
  apply(readModePreference(storage));
  button.addEventListener('click', () => { const mode = current() === 'exam' ? 'standard' : 'exam'; rememberMode(storage, mode); apply(mode); });
  return { current };
}
export function modeContext(run, selection) {
  if (run) return `${t('Viewing')}: ${run.configuration?.task.title ?? run.task_id ?? t('Legacy task')} · ${run.configuration?.model_profile.label ?? t('Legacy profile')} · ${run.model ? `${t(run.model.is_mock ? 'Mock' : 'Live')} ${run.model.name}` : t('Model unavailable')} · ${currentLocale() === 'en' ? run.status.replaceAll('_', ' ') : t({ running:'Running', awaiting_approval:'Awaiting approval', completed:'Completed', failed:'Failed', stopped:'Stopped' }[run.status] ?? run.status)}`;
  if (!selection) return t('Loading backend configuration…');
  return `${t('Next run')}: ${selection.task.title} · ${t(selection.profile.is_mock ? 'Mock' : 'Live')} ${selection.profile.name} · ${t(selection.profile.status)}`;
}
