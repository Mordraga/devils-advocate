// Small DOM helpers shared by the host and contestant pages. Everything is
// built with textContent (never innerHTML) because contestants choose their
// own display names, and those get rendered on the host's screen.

export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text != null) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  for (const [event, handler] of Object.entries(options.on ?? {})) node.addEventListener(event, handler);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Rebuilds a progress list; done/current/upcoming are text-marked, not just colored. */
export function renderStepper(container, labels, currentIndex) {
  container.replaceChildren(
    ...labels.map((label, i) => {
      const status = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
      const marker = status === 'done' ? '✓ ' : '';
      const item = el('li', { class: `step step-${status}`, text: `${marker}${label}` });
      if (status === 'current') item.setAttribute('aria-current', 'step');
      return item;
    }),
  );
}

/** Copies text; returns false (so the caller can show it instead) if the browser refuses. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Briefly relabels a button ("Copied ✓") then puts the original text back. */
export function flash(button, text, ms = 1500) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.textContent = original;
  }, ms);
}
