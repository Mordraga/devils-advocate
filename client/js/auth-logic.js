// Pure helpers for the host sign-in gate (auth.js): what to tell the host
// when a Twitch login sends them back, how to label who is signed in, and
// how to tidy the address afterwards. No DOM, so it is unit tested.

const MESSAGES = {
  forbidden: "That Twitch account isn't on the host list.",
  denied: 'The Twitch login was cancelled.',
  error: "Twitch didn't answer properly. Try again, or use the admin token.",
  state: 'That login attempt expired or started in a different browser. Try again.',
};

/** The line for `?auth=<reason>` (null when there is nothing to say). */
export function authMessage(reason) {
  return MESSAGES[reason] ?? null;
}

/** The address without our `auth` marker, so a refresh doesn't repeat the message. */
export function withoutAuthParam(href) {
  const url = new URL(href);
  url.searchParams.delete('auth');
  return url.toString();
}

/** "Signed in as Mordraga0" / "Using the admin token". */
export function accountLabel(me) {
  if (!me?.authenticated) return '';
  return me.via === 'twitch' ? `Signed in as ${me.displayName || me.login}` : 'Using the admin token';
}
