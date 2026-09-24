// Topics admin (spec section 9's topic management): browse, filter, switch
// topics on and off, tune how often they come up, add and edit them, and
// import/export the whole set. Validation rules live in topics-logic.js
// (pure, tested); the server stays the real authority.

import * as api from './api.js';
import { requireAuth } from './auth.js';
import { el } from './ui.js';
import {
  emptyForm,
  filterTopics,
  formToPayload,
  parseImportFile,
  summarize,
  topicToForm,
  validateForm,
  warnings,
} from './topics-logic.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['prompt', 'explainer', 'sideA', 'sideB', 'category', 'subject', 'tags', 'contentWarning', 'weight'];

let topics = [];
const filter = { q: '', category: '', status: 'all' };
let editingId = null; // null = adding a new topic

// ---- messages --------------------------------------------------------------

let noticeTimer = null;
function notice(message) {
  const box = $('topics-notice');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (box.hidden = true), 5000);
}

function showError(message) {
  const box = $('topics-error');
  box.textContent = message;
  box.hidden = false;
}

const hideError = () => ($('topics-error').hidden = true);

// ---- list ------------------------------------------------------------------

function renderSummary() {
  const s = summarize(topics);
  $('topics-summary').textContent = `${s.total} topics · ${s.enabled} in rotation · ${s.edited} edited by you`;

  const select = $('filter-category');
  const current = select.value;
  select.replaceChildren(
    el('option', { text: 'All categories', attrs: { value: '' } }),
    ...s.categories.map((c) => el('option', { text: c, attrs: { value: c } })),
  );
  select.value = s.categories.includes(current) ? current : '';
  filter.category = select.value;

  $('category-options').replaceChildren(...s.categories.map((c) => el('option', { attrs: { value: c } })));
}

async function patch(topic, changes, control) {
  hideError();
  try {
    const updated = await api.updateTopic(topic.id, changes);
    topics = topics.map((t) => (t.id === updated.id ? updated : t));
    renderSummary();
    renderList();
  } catch (err) {
    showError(err.message);
    if (control) {
      // put the control back to what the server still has
      if (control.type === 'checkbox') control.checked = topic.enabled;
      else control.value = String(topic.weight);
    }
  }
}

function topicItem(topic) {
  const enabled = el('input', { attrs: { type: 'checkbox' } });
  enabled.checked = topic.enabled;
  enabled.addEventListener('change', () => patch(topic, { enabled: enabled.checked }, enabled));

  const weight = el(
    'select',
    { class: 'crypt-input weight-select', attrs: { 'aria-label': `Weight for ${topic.prompt}` } },
    ...Array.from({ length: 10 }, (_, i) => el('option', { text: String(i + 1), attrs: { value: String(i + 1) } })),
  );
  weight.value = String(topic.weight);
  weight.addEventListener('change', () => patch(topic, { weight: Number(weight.value) }, weight));

  const badges = [el('span', { class: 'badge', text: topic.category })];
  if (topic.customized) badges.push(el('span', { class: 'badge badge-gold', text: 'edited' }));
  if (topic.times_used > 0) badges.push(el('span', { class: 'badge', text: `used ${topic.times_used}×` }));
  if (!topic.enabled) badges.push(el('span', { class: 'badge badge-accent', text: 'switched off' }));

  return el(
    'li',
    { class: `topic-item card${topic.enabled ? '' : ' topic-off'}`, attrs: { 'data-id': topic.id } },
    el(
      'div',
      { class: 'topic-main' },
      el('h3', { class: 'topic-prompt', text: topic.prompt }),
      topic.explainer
        ? el('p', { class: 'topic-explainer', text: topic.explainer })
        : el('p', { class: 'topic-missing', text: 'No explainer yet - contestants may not know what this means.' }),
      el('p', { class: 'topic-sides', text: `A: ${topic.side_a}   ·   B: ${topic.side_b}` }),
      el('div', { class: 'topic-badges' }, ...badges),
    ),
    el(
      'div',
      { class: 'topic-controls' },
      el('label', { class: 'toggle-row' }, enabled, el('span', { text: 'In rotation' })),
      el('label', { class: 'weight-row' }, el('span', { class: 'field-label', text: 'Weight' }), weight),
      el('button', { class: 'btn btn-ghost', text: 'Edit', attrs: { type: 'button' }, on: { click: () => openForm(topic) } }),
    ),
  );
}

function renderList() {
  const shown = filterTopics(topics, filter);
  $('topic-list').replaceChildren(...shown.map(topicItem));
  $('topics-empty').hidden = shown.length > 0;
}

// ---- form ------------------------------------------------------------------

function readForm() {
  const values = {};
  for (const name of FIELDS) values[name] = $(`f-${name}`).value;
  values.enabled = $('f-enabled').checked;
  return values;
}

function writeForm(values) {
  for (const name of FIELDS) $(`f-${name}`).value = values[name] ?? '';
  $('f-enabled').checked = Boolean(values.enabled);
}

function clearFieldErrors() {
  for (const name of FIELDS) {
    const box = $(`e-${name}`);
    if (box) box.hidden = true;
  }
}

function updatePreview() {
  const values = readForm();
  const p = formToPayload(values);
  $('preview-prompt').textContent = p.prompt || 'Your question appears here';
  $('preview-explainer').textContent = p.explainer ?? '';
  $('preview-explainer').hidden = !p.explainer;
  $('preview-sides').textContent = p.side_a || p.side_b ? `A: ${p.side_a || '…'}   ·   B: ${p.side_b || '…'}` : '';
  $('form-warnings').replaceChildren(...(p.prompt ? warnings(values) : []).map((w) => el('li', { text: w })));
}

function openForm(topic = null) {
  hideError();
  clearFieldErrors();
  editingId = topic?.id ?? null;
  $('form-title').textContent = topic ? 'Edit topic' : 'Add a topic';
  writeForm(topic ? topicToForm(topic) : emptyForm());
  updatePreview();
  $('form-card').hidden = false;
  $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('f-prompt').focus();
}

function closeForm() {
  $('form-card').hidden = true;
  editingId = null;
}

$('topic-form').addEventListener('input', updatePreview);

$('topic-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();
  clearFieldErrors();

  const values = readForm();
  const errors = validateForm(values);
  const names = Object.keys(errors);
  if (names.length) {
    for (const name of names) {
      const box = $(`e-${name}`);
      box.textContent = errors[name];
      box.hidden = false;
    }
    $(`f-${names[0]}`).focus();
    return;
  }

  const payload = formToPayload(values);
  const button = $('btn-save');
  button.disabled = true;
  try {
    const saved = editingId ? await api.updateTopic(editingId, payload) : await api.createTopic(payload);
    topics = editingId ? topics.map((t) => (t.id === saved.id ? saved : t)) : [...topics, saved];
    renderSummary();
    renderList();
    closeForm();
    notice(`Saved “${saved.prompt}”.`);
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
});

$('btn-cancel').addEventListener('click', closeForm);
$('btn-add').addEventListener('click', () => openForm());

// ---- filters ---------------------------------------------------------------

$('filter-q').addEventListener('input', (e) => {
  filter.q = e.target.value;
  renderList();
});
$('filter-category').addEventListener('change', (e) => {
  filter.category = e.target.value;
  renderList();
});
$('filter-status').addEventListener('change', (e) => {
  filter.status = e.target.value;
  renderList();
});

// ---- export / import ---------------------------------------------------------

$('btn-export').addEventListener('click', async () => {
  hideError();
  try {
    const data = await api.exportTopics();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = el('a', { attrs: { href: URL.createObjectURL(blob), download: `topics-${new Date().toISOString().slice(0, 10)}.json` } });
    document.body.append(link);
    link.click();
    link.remove();
    notice(`Exported ${data.length} topics.`);
  } catch (err) {
    showError(err.message);
  }
});

$('btn-import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = ''; // so choosing the same file again still fires
  if (!file) return;
  hideError();
  try {
    const list = parseImportFile(await file.text());
    const result = await api.importTopics(list);
    topics = await api.listTopics();
    renderSummary();
    renderList();
    notice(`Imported: ${result.created} added, ${result.updated} updated.`);
  } catch (err) {
    showError(err.message);
  }
});

// ---- start -----------------------------------------------------------------

requireAuth()
  .then(() => api.listTopics())
  .then((list) => {
    topics = list;
    renderSummary();
    renderList();
  })
  .catch((err) => {
    $('topics-summary').textContent = 'Could not load topics.';
    showError(err.message);
  });
