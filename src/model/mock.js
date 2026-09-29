// MOCK models — they stand in for an LLM so the backend can be demonstrated and
// tested offline. A passing mock run proves the RUNNER works (validation, approval,
// limits, state). It proves nothing about a real model's ability to choose steps.

import { ModelError } from './openaiCompatible.js';
import { tokenize } from '../retrieval/keywordSearch.js';

const SAVE_WORDS = new Set(['luu', 'save', 'draft', 'ban', 'nhap', 'tom', 'tat']);
const INJECTION_HINT = /(ignore (all )?previous instructions|system override|you are now|admin mode|bỏ qua mọi chỉ dẫn)/i;

/**
 * Rule-based stand-in used by the UI when MODEL_PROVIDER=mock.
 * It reads the goal and the latest observation and picks the next action, so a
 * different tool result really does lead to a different next action.
 */
export function createRuleBasedMock() {
  return {
    provider: 'mock',
    name: 'rule-based-mock',
    isMock: true,
    async complete({ messages }) {
      return { text: JSON.stringify(decide(messages)), usage: null };
    },
  };
}

function decide(messages) {
  const goal = (messages.find((m) => m.role === 'user')?.content || '').replace(/^GOAL:\s*/, '');
  const observations = messages
    .filter((m) => m.role === 'user' && m.content.startsWith('OBSERVATION'))
    .map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
  const searches = observations.filter((o) => o.tool === 'search_notes' && o.status === 'ok');
  const goalTokens = tokenize(goal);
  const wantsSave = ['luu', 'save', 'draft'].some((w) => goalTokens.includes(w)) || /\bban nhap\b/.test(goalTokens.join(' '));
  const saveOutcome = observations.find((o) => o.tool === 'save_draft');

  if (!searches.length) {
    const query = goal.replace(/\b(lưu|luu|save|draft|bản nháp|ban nhap|tóm tắt|tom tat)\b/gi, ' ').trim().slice(0, 200) || goal.slice(0, 200);
    return { type: 'tool_call', tool: 'search_notes', arguments: { query, limit: 3 } };
  }

  // Mock-only courtesy: do not repeat passages that look like instructions to the model.
  // This is NOT the security boundary — the backend's allow-list and approval gate are,
  // and they hold even when a (real or scripted) model obeys the injected text.
  const all = searches.at(-1).untrusted_data?.results || [];
  const suspicious = all.filter((r) => INJECTION_HINT.test(r.text));
  const results = all.filter((r) => !INJECTION_HINT.test(r.text));
  const flag = suspicious.length ? `\n\nĐã bỏ qua ${suspicious.length} đoạn chứa chỉ dẫn đáng ngờ (${suspicious.map((r) => `${r.source_id} §${r.passage}`).join(', ')}).` : '';
  if (!results.length) {
    return { type: 'final', answer: 'Không tìm thấy thông tin phù hợp trong ghi chú.', source_ids: [], unresolved: 'Ghi chú hiện có không chứa thông tin cho mục tiêu này; cần bổ sung tài liệu.' };
  }

  // Keep only passages scoring at least half of the best one.
  const top = results.filter((r) => r.score >= results[0].score / 2).slice(0, 2);
  // Crude "does this actually answer it?" check: at least half of the goal's keywords must
  // appear in the kept passages. A real LLM reads the text instead; this heuristic exists
  // only so the mock can show the "not enough evidence" path deterministically.
  const goalTerms = [...new Set(tokenize(goal).filter((t) => !SAVE_WORDS.has(t)))];
  const seen = new Set(tokenize(top.map((r) => `${r.title} ${r.text}`).join(' ')));
  const coverage = goalTerms.length ? goalTerms.filter((t) => seen.has(t)).length / goalTerms.length : 0;
  if (coverage < 0.5) {
    return {
      type: 'final',
      answer: 'Ghi chú có đoạn liên quan tới chủ đề nhưng không chứa thông tin trả lời trực tiếp câu hỏi này.',
      source_ids: [],
      unresolved: `Không đủ bằng chứng: chỉ ${Math.round(coverage * 100)}% từ khóa của câu hỏi xuất hiện trong các đoạn tìm được. Cần bổ sung tài liệu.`,
    };
  }
  const ids = [...new Set(top.map((r) => r.source_id))];
  const summary = top.map((r) => `${r.text} [${r.source_id} §${r.passage}]`).join('\n');

  if (wantsSave && !saveOutcome) {
    return { type: 'tool_call', tool: 'save_draft', arguments: { title: `Tóm tắt: ${top[0].title}`.slice(0, 120), content: summary.slice(0, 4000), source_ids: ids } };
  }
  const saveNote = !saveOutcome ? '' : saveOutcome.status === 'ok' ? '\n\nĐã lưu bản nháp.' : '\n\nBản nháp KHÔNG được lưu (bị từ chối hoặc lỗi).';
  return { type: 'final', answer: `Theo ghi chú:\n${summary}${flag}${saveNote}`.slice(0, 2000), source_ids: ids, unresolved: '' };
}

/**
 * Scripted mock for tests: returns the given replies in order.
 * A reply may be a string, a function(messages) => string, or
 * { error: 'timeout'|'unavailable' } / { delayMs, text } to simulate failures.
 */
export function createScriptedModel(replies) {
  let i = 0;
  const calls = [];
  return {
    provider: 'mock',
    name: 'scripted-mock',
    isMock: true,
    calls,
    async complete({ messages, signal }) {
      calls.push(messages);
      const reply = replies[Math.min(i++, replies.length - 1)];
      if (reply && typeof reply === 'object' && reply.error) throw new ModelError(reply.error, `Simulated ${reply.error}.`);
      if (reply && typeof reply === 'object' && reply.delayMs) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, reply.delayMs);
          signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ModelError('timeout', 'Model call timed out or was cancelled.')); }, { once: true });
        });
        return { text: reply.text, usage: null };
      }
      const text = typeof reply === 'function' ? reply(messages) : reply;
      return { text: typeof text === 'string' ? text : JSON.stringify(text), usage: null };
    },
  };
}
