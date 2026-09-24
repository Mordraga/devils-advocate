// Pure logic for the topics page: form parsing/validation, filtering and
// counting. No DOM, so it can be checked without a browser (see
// client/tests/topics-logic.test.mjs).

export const LIMITS = { prompt: 200, explainer: 400, side: 120, category: 64, tags: 12 };

/** "food ontology, cursed pull" -> ["food_ontology", "cursed_pull"] (deduped, snake_case). */
export function parseTags(text) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(text ?? '').split(',')) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/** Turns the form's raw string values into the API's body. */
export function formToPayload(values) {
  const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
  return {
    prompt: String(values.prompt ?? '').trim(),
    explainer: blank(values.explainer),
    side_a: String(values.sideA ?? '').trim(),
    side_b: String(values.sideB ?? '').trim(),
    category: String(values.category ?? '').trim(),
    subject: blank(values.subject),
    tags: parseTags(values.tags),
    content_warning: blank(values.contentWarning),
    weight: Number(values.weight),
    enabled: Boolean(values.enabled),
  };
}

/**
 * Field-level problems, keyed by field name, so the form can point at the
 * exact input. Mirrors the server's rules (which stay the real authority).
 */
export function validateForm(values) {
  const p = formToPayload(values);
  const errors = {};
  if (!p.prompt) errors.prompt = 'Write the question.';
  else if (p.prompt.length > LIMITS.prompt) errors.prompt = `Keep it under ${LIMITS.prompt} characters.`;
  if (p.explainer && p.explainer.length > LIMITS.explainer) errors.explainer = `Keep it under ${LIMITS.explainer} characters.`;
  if (!p.side_a) errors.sideA = 'Give side A a position.';
  else if (p.side_a.length > LIMITS.side) errors.sideA = `Keep it under ${LIMITS.side} characters.`;
  if (!p.side_b) errors.sideB = 'Give side B a position.';
  else if (p.side_b.length > LIMITS.side) errors.sideB = `Keep it under ${LIMITS.side} characters.`;
  if (!p.category.replace(/[^a-zA-Z0-9]/g, '')) errors.category = 'Pick or type a category.';
  if (p.tags.length > LIMITS.tags) errors.tags = `At most ${LIMITS.tags} tags.`;
  if (!Number.isInteger(p.weight) || p.weight < 1 || p.weight > 10) errors.weight = 'Weight is a whole number from 1 to 10.';
  return errors;
}

/** Non-blocking nudges - the explainer is why the field exists. */
export function warnings(values) {
  const p = formToPayload(values);
  const out = [];
  if (!p.explainer) out.push('No explainer: contestants may not know what the question means.');
  if (p.side_a && p.side_b && p.side_a.toLowerCase() === p.side_b.toLowerCase()) out.push('Both sides say the same thing.');
  return out;
}

/** A topic (from the API) back into the form's string values. */
export function topicToForm(topic) {
  return {
    prompt: topic.prompt,
    explainer: topic.explainer ?? '',
    sideA: topic.side_a,
    sideB: topic.side_b,
    category: topic.category,
    subject: topic.subject ?? '',
    tags: (topic.tags ?? []).join(', '),
    contentWarning: topic.content_warning ?? '',
    weight: topic.weight,
    enabled: topic.enabled,
  };
}

export const emptyForm = () => ({
  prompt: '',
  explainer: '',
  sideA: '',
  sideB: '',
  category: '',
  subject: '',
  tags: '',
  contentWarning: '',
  weight: 2,
  enabled: true,
});

/** filter = { q, category ('' = all), status ('all' | 'enabled' | 'disabled') } */
export function filterTopics(topics, filter = {}) {
  const q = String(filter.q ?? '').trim().toLowerCase();
  return topics.filter((t) => {
    if (filter.category && t.category !== filter.category) return false;
    if (filter.status === 'enabled' && !t.enabled) return false;
    if (filter.status === 'disabled' && t.enabled) return false;
    if (q) {
      const haystack = `${t.prompt} ${t.explainer ?? ''} ${t.side_a} ${t.side_b} ${t.slug}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function summarize(topics) {
  return {
    total: topics.length,
    enabled: topics.filter((t) => t.enabled).length,
    edited: topics.filter((t) => t.customized).length,
    categories: [...new Set(topics.map((t) => t.category))].sort(),
  };
}

/** Accepts the export's array, or `{ topics: [...] }`; throws a readable error otherwise. */
export function parseImportFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const list = Array.isArray(data) ? data : data?.topics;
  if (!Array.isArray(list) || list.length === 0) throw new Error('No topics found in that file.');
  return list;
}
