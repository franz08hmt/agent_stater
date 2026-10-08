// Small, escaped renderer for the Markdown subset used by the oral exam notes.
// Not a general Markdown engine. Raw HTML is text, never executable content.
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const normalizeSearch = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

export function inline(text) {
  const tokens = /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let html = '', position = 0;
  for (const match of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(position, match.index));
    if (match[1]) html += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[4]) html += `<strong>${escapeHtml(match[4])}</strong>`;
    else {
      const [label, url] = [escapeHtml(match[2]), match[3]];
      if (/^https?:\/\//i.test(url)) html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      else if (/^(?:\.\.\/)?[a-zA-Z0-9_./-]+$/.test(url) && !url.startsWith('//')) html += `<button type="button" class="source-link" data-resource="${escapeHtml(url)}">${label}</button>`;
      else html += label;
    }
    position = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(position));
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n'), out = [];
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const isBlock = line => /^\s*$|^```|^#{1,6} |^[-*] |^\d+\. |^\|/.test(line);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(), code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<figure class="code-block"><figcaption>${escapeHtml(language || 'Code / ví dụ')}</figcaption><pre tabindex="0"><code>${escapeHtml(code.join('\n'))}</code></pre></figure>`);
    } else if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() || '')) {
      const head = cells(line), rows = []; i += 2;
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<section class="table-scroll" tabindex="0" aria-label="Bảng so sánh; cuộn ngang nếu cần"><table><thead><tr>${head.map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`);
    } else if (/^[-*] |^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line), rows = [], pattern = ordered ? /^\d+\. / : /^[-*] /;
      while (i < lines.length && pattern.test(lines[i])) rows.push(inline(lines[i++].replace(pattern, '')));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${rows.map(r => `<li>${r}</li>`).join('')}</${tag}>`);
    } else if (/^#{1,6} /.test(line)) {
      out.push(`<h4>${inline(line.replace(/^#{1,6} /, ''))}</h4>`); i++;
    } else {
      const paragraph = [line]; i++;
      while (i < lines.length && !isBlock(lines[i])) paragraph.push(lines[i++]);
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

export function parseStudy(markdown) {
  const chapters = [], questions = [];
  let intro = '', chapter, question, fenced = false;
  for (const line of markdown.replace(/\r/g, '').split('\n')) {
    const section = !fenced && line.match(/^## (.+)$/), q = !fenced && line.match(/^### Q(\d+)\. (.+)$/);
    if (section) { chapter = { id: `chapter-${chapters.length + 1}`, title: section[1], intro: '', questions: [] }; chapters.push(chapter); question = null; }
    else if (q) {
      if (!chapter) throw new Error('Question requires a chapter.');
      const id = `q${Number(q[1])}`;
      if (questions.some(item => item.id === id)) throw new Error(`Duplicate question ${id}.`);
      question = { id, label: `Q${q[1]}`, title: q[2], chapter: chapters.length - 1, body: '' };
      questions.push(question); chapter.questions.push(id);
    } else if (question) question.body += `${line}\n`;
    else if (chapter) chapter.intro += `${line}\n`;
    else if (!line.startsWith('# ')) intro += `${line}\n`;
    if (line.startsWith('```')) fenced = !fenced;
  }
  return { intro, chapters, questions };
}
