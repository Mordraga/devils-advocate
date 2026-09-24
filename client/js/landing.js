// Landing page: enter a room code to watch and vote (the Jackbox-style way in).

import { getPublicSession } from './api.js';
import { withApi } from './config.js';

const $ = (id) => document.getElementById(id);

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('join-error');
  error.hidden = true;

  // Codes are upper-case letters and digits; forgive stray spaces and case.
  const code = $('room-code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;

  const button = $('join-submit');
  button.disabled = true;
  try {
    await getPublicSession(code);
    location.href = withApi(`watch.html?session=${code}`);
  } catch (err) {
    error.textContent = /failed: 404/.test(err.message)
      ? `We couldn't find a room with the code ${code}. Check the code on the stream.`
      : "Couldn't reach the show right now. Try again in a moment.";
    error.hidden = false;
    button.disabled = false;
  }
});
