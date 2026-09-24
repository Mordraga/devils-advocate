// Pure helpers for the archive page: the ready-to-post summary of a round and
// a readable date. No DOM, so both are unit tested (tests/archive-logic.test.mjs).

const round1 = (n) => Math.round(n * 10) / 10;
const sideName = (entry, side) => entry.names?.[side] || `Side ${side}`;
// Wrap in quotes unless the side already comes quoted (e.g. "Yanny").
const quoted = (text) => (/^["“]/.test(text) ? text : `"${text}"`);
const sideText = (entry, side) => (side === 'A' ? entry.topic?.sideA : entry.topic?.sideB) ?? '';

/** "Alice won: chat swung 16 points toward "No" (30% to 46%)." - or the draw / void line. */
export function resultLine(entry) {
  if (entry.status === 'void') return "This round was voided and doesn't count.";
  if (entry.winner === 'draw') return 'It was a draw: chat did not move either way.';
  if (entry.winner !== 'A' && entry.winner !== 'B') return '';

  const winner = entry.winnerName || sideName(entry, entry.winner);
  const key = entry.winner.toLowerCase();
  const before = entry.opening?.[key];
  const after = entry.closing?.[key];
  const points = entry.sway?.[key];
  if (before == null || after == null || points == null) return `${winner} won.`;
  const target = sideText(entry, entry.winner);
  return `${winner} won: chat swung ${round1(Math.abs(points))} points toward ${quoted(target)} (${round1(before)}% to ${round1(after)}%).`;
}

/** The round as a few lines of text, ready to paste into a post. */
export function shitpostText(entry) {
  const lines = [];
  if (entry.topic?.prompt) lines.push(entry.topic.prompt);
  if (entry.topic) {
    lines.push(`${sideName(entry, 'A')} (${sideText(entry, 'A')}) vs ${sideName(entry, 'B')} (${sideText(entry, 'B')})`);
  }
  const result = resultLine(entry);
  if (result) lines.push(result);
  lines.push("Devil's Advocate - advocate.mordraga.me");
  return lines.join('\n');
}

/** "24 Sep 2026", or '' for a missing/garbled timestamp. */
export function whenText(iso, locale = 'en-GB') {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
