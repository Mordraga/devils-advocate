// An anonymous id for this browser, so a viewer gets one vote per poll (and
// can change it) without any account. Not a secret and not an identity -
// clearing site data or using a private window simply makes a new one.

const KEY = 'devils-advocate:voter-id';
let inMemory = null;

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; getRandomValues doesn't.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getVoterId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = makeId();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Storage blocked: stable for this page load only.
    inMemory ??= makeId();
    return inMemory;
  }
}
