// The host pages' sign-in gate. `requireAuth()` asks the server who you are;
// if the answer is "nobody" it hides the page behind a sign-in card (Twitch
// login, with the shared admin token as the fallback) and resolves once you
// are in. Used by host.js and topics.js.

import * as api from './api.js';
import { accountLabel, authMessage, withoutAuthParam } from './auth-logic.js';
import { el } from './ui.js';

function takeReturnMessage() {
  const reason = new URLSearchParams(location.search).get('auth');
  if (!reason) return null;
  history.replaceState(null, '', withoutAuthParam(location.href));
  return authMessage(reason);
}

function mountAccountBar(me) {
  const nav = document.querySelector('.nav-inner');
  if (!nav) return;
  const label = el('span', { class: 'account-label', text: accountLabel(me) });
  const out = el('button', {
    class: 'link-btn',
    text: 'Sign out',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        try {
          if (me.via === 'twitch') await api.signOut();
        } catch {
          // already signed out - fall through to the reload
        }
        api.clearAdminToken();
        location.reload();
      },
    },
  });
  nav.append(el('div', { class: 'account-bar' }, label, out));
}

function buildGate(me, message, onSignedIn) {
  const error = el('p', { class: 'now-error', attrs: { role: 'alert' }, text: message ?? '' });
  error.hidden = !message;

  const tokenInput = el('input', {
    class: 'crypt-input',
    attrs: { type: 'password', id: 'gate-token', autocomplete: 'off', 'aria-label': 'Admin token' },
  });
  const tokenForm = el(
    'form',
    { class: 'name-form gate-token-form', on: { submit: (event) => submitToken(event) } },
    el('label', { class: 'field-label', text: 'Admin token', attrs: { for: 'gate-token' } }),
    tokenInput,
    el('button', { class: 'btn btn-ghost', text: 'Use this token', attrs: { type: 'submit' } }),
  );

  async function submitToken(event) {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    api.setAdminToken(token);
    try {
      const now = await api.getAuth();
      if (now.authenticated) {
        onSignedIn(now);
        return;
      }
    } catch {
      // fall through to the message below
    }
    api.clearAdminToken();
    error.textContent = "That token wasn't accepted.";
    error.hidden = false;
    tokenInput.select();
  }

  const children = [el('h2', { text: 'Host sign-in' })];
  if (me?.twitchEnabled) {
    children.push(
      el('p', { text: 'Sign in with the Twitch account that runs the show.' }),
      el('a', { class: 'btn btn-gold', text: 'Log in with Twitch', attrs: { href: api.twitchLoginUrl(withoutAuthParam(location.href)) } }),
    );
  }
  children.push(error);

  // Twitch login is the front door; the token is the way in when it's down or not set up.
  const tokenBlock = el('details', { class: 'gate-token' }, el('summary', { text: 'Use the admin token instead' }), tokenForm);
  if (!me?.twitchEnabled) {
    tokenBlock.open = true;
    children.splice(1, 0, el('p', { text: 'Enter the admin token to continue.' }));
  }
  children.push(tokenBlock);

  return el('section', { class: 'card card-gold auth-gate' }, ...children);
}

/** Resolves (with who you are) once the page may be used. */
export async function requireAuth() {
  const main = document.querySelector('main');
  const message = takeReturnMessage();

  let me = null;
  try {
    me = await api.getAuth();
  } catch {
    // Server unreachable: the gate below says so.
  }
  if (me?.authenticated) {
    mountAccountBar(me);
    window.addEventListener('da-auth-lost', () => location.reload());
    return me;
  }

  main.classList.add('auth-locked');
  return new Promise((resolve) => {
    const gate = buildGate(me, me ? message : "Can't reach the server right now. Try again in a moment.", (signedIn) => {
      gate.remove();
      main.classList.remove('auth-locked');
      mountAccountBar(signedIn);
      window.addEventListener('da-auth-lost', () => location.reload());
      resolve(signedIn);
    });
    main.prepend(gate);
  });
}
