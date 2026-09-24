import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyForm,
  filterTopics,
  formToPayload,
  parseImportFile,
  parseTags,
  summarize,
  topicToForm,
  validateForm,
  warnings,
} from '../js/topics-logic.js';

const good = () => ({
  prompt: 'Is a pop-tart a ravioli?',
  explainer: 'Filling sealed inside pastry.',
  sideA: 'Yes',
  sideB: 'No',
  category: 'food_court',
  subject: '',
  tags: 'Food Ontology, food_ontology, ',
  contentWarning: '',
  weight: '3',
  enabled: true,
});

const topic = (over = {}) => ({
  slug: 't1',
  prompt: 'Is Odin a pirate?',
  explainer: 'One eye, two birds.',
  side_a: 'Yes',
  side_b: 'No',
  category: 'occult_nonsense',
  tags: ['occult'],
  weight: 2,
  enabled: true,
  customized: false,
  ...over,
});

test('tags are split, snake_cased and deduplicated', () => {
  assert.deepEqual(parseTags('Food Ontology, food_ontology, , Cursed Pull!'), ['food_ontology', 'cursed_pull']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(undefined), []);
});

test('the form becomes the API body, with blanks as null', () => {
  const p = formToPayload(good());
  assert.equal(p.prompt, 'Is a pop-tart a ravioli?');
  assert.equal(p.side_a, 'Yes');
  assert.equal(p.subject, null);
  assert.equal(p.content_warning, null);
  assert.deepEqual(p.tags, ['food_ontology']);
  assert.equal(p.weight, 3);
  assert.equal(p.enabled, true);
});

test('a good form has no errors', () => {
  assert.deepEqual(validateForm(good()), {});
});

test('each problem points at its own field', () => {
  const errors = validateForm({ ...good(), prompt: ' ', sideA: '', sideB: 'x'.repeat(121), category: '!!', weight: '0' });
  assert.deepEqual(Object.keys(errors).sort(), ['category', 'prompt', 'sideA', 'sideB', 'weight']);
  assert.equal(validateForm({ ...good(), weight: '2.5' }).weight, 'Weight is a whole number from 1 to 10.');
  assert.ok(validateForm({ ...good(), prompt: 'x'.repeat(201) }).prompt.includes('200'));
  assert.ok(validateForm({ ...good(), explainer: 'x'.repeat(401) }).explainer.includes('400'));
});

test('a missing explainer is a nudge, not an error', () => {
  const values = { ...good(), explainer: '' };
  assert.deepEqual(validateForm(values), {});
  assert.match(warnings(values)[0], /explainer/);
  assert.match(warnings({ ...good(), sideB: 'yes' })[0], /same thing/);
  assert.deepEqual(warnings(good()), []);
});

test('a topic round-trips through the form', () => {
  const form = topicToForm({ ...topic(), subject: null, content_warning: null, tags: ['a', 'b'], weight: 4 });
  assert.equal(form.tags, 'a, b');
  assert.equal(form.subject, '');
  assert.equal(formToPayload(form).weight, 4);
  assert.deepEqual(validateForm(form), {});
  assert.equal(emptyForm().weight, 2);
});

test('filtering by search, category and status', () => {
  const topics = [
    topic(),
    topic({ slug: 't2', prompt: 'Is cereal a soup?', category: 'food_court', enabled: false, explainer: null }),
    topic({ slug: 't3', prompt: 'PC or console?', category: 'gaming_argument', explainer: null }),
  ];
  assert.equal(filterTopics(topics, { q: 'ODIN' }).length, 1);
  assert.equal(filterTopics(topics, { q: 'birds' }).length, 1); // searches the explainer too
  assert.equal(filterTopics(topics, { category: 'food_court' }).length, 1);
  assert.equal(filterTopics(topics, { status: 'disabled' }).length, 1);
  assert.equal(filterTopics(topics, { status: 'enabled' }).length, 2);
  assert.equal(filterTopics(topics, {}).length, 3);
  assert.equal(filterTopics(topics, { q: 'soup', status: 'enabled' }).length, 0);
});

test('summary counts', () => {
  const s = summarize([topic(), topic({ enabled: false, customized: true, category: 'a' })]);
  assert.deepEqual(s, { total: 2, enabled: 1, edited: 1, categories: ['a', 'occult_nonsense'] });
});

test('import files: an array or {topics}, and readable errors', () => {
  assert.equal(parseImportFile('[{"id":"x"}]').length, 1);
  assert.equal(parseImportFile('{"topics":[{"id":"x"},{"id":"y"}]}').length, 2);
  assert.throws(() => parseImportFile('not json'), /valid JSON/);
  assert.throws(() => parseImportFile('[]'), /No topics/);
  assert.throws(() => parseImportFile('{"nope":1}'), /No topics/);
});
