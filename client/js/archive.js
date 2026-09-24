// The archive: rounds the host chose to keep, newest first, each with a
// ready-to-paste summary for posting about it later. Read-only.

import * as api from './api.js';
import { requireAuth } from './auth.js';
import { resultLine, shitpostText, whenText } from './archive-logic.js';
import { copyText, el, flash } from './ui.js';

const $ = (id) => document.getElementById(id);

function card(entry) {
  const text = shitpostText(entry);
  const fallback = el('pre', { class: 'archive-post', text });
  fallback.hidden = true;

  const copy = el('button', {
    class: 'btn btn-ghost',
    text: 'Copy for a post',
    attrs: { type: 'button' },
    on: {
      click: async (event) => {
        if (await copyText(text)) flash(event.currentTarget, 'Copied ✓');
        else fallback.hidden = false; // the browser refused - show it to copy by hand
      },
    },
  });

  const badges = [];
  if (entry.topic?.category) badges.push(el('span', { class: 'badge', text: entry.topic.category }));
  if (entry.status === 'void') badges.push(el('span', { class: 'badge badge-accent', text: 'voided' }));

  return el(
    'li',
    { class: 'card archive-item' },
    el('div', { class: 'archive-when', text: [whenText(entry.archivedAt), entry.sessionTitle].filter(Boolean).join(' · ') }),
    el('h3', { class: 'topic-prompt', text: entry.topic?.prompt ?? '(no topic was drawn)' }),
    entry.topic?.explainer ? el('p', { class: 'topic-explainer', text: entry.topic.explainer }) : null,
    entry.topic
      ? el('p', { class: 'topic-sides', text: `A: ${entry.topic.sideA} (${entry.names.A ?? '?'})   ·   B: ${entry.topic.sideB} (${entry.names.B ?? '?'})` })
      : null,
    el('p', { class: 'archive-result', text: resultLine(entry) }),
    el('div', { class: 'topic-badges' }, ...badges),
    el('div', { class: 'control-group' }, copy),
    fallback,
  );
}

requireAuth()
  .then(() => api.listArchive())
  .then((entries) => {
    $('archive-summary').textContent = `${entries.length} archived round${entries.length === 1 ? '' : 's'}`;
    $('archive-list').replaceChildren(...entries.map(card));
    $('archive-empty').hidden = entries.length > 0;
  })
  .catch((err) => {
    $('archive-summary').textContent = 'Could not load the archive.';
    $('archive-error').textContent = err.message;
    $('archive-error').hidden = false;
  });
