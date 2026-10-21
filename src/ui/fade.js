// Full-screen fade to black and back, with an optional caption as the scene returns.
const overlay = document.getElementById('fade');
const caption = document.getElementById('fade-text');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fade = { active: false };

export function setCaption(text) {
  caption.textContent = text;
  caption.classList.toggle('on', !!text);
}

// onBlack runs (and is awaited) while the screen is fully black.
export async function fadeThrough({ out = 700, hold = 500, back = 900, text, textHold = 2200, onBlack }) {
  fade.active = true;
  overlay.style.transitionDuration = `${out}ms`;
  overlay.classList.add('on');
  await wait(out);
  await onBlack?.();
  await wait(hold);
  setCaption(text ?? '');
  overlay.style.transitionDuration = `${back}ms`;
  overlay.classList.remove('on');
  await wait(back);
  fade.active = false;
  if (text) {
    await wait(textHold);
    if (caption.textContent === text) setCaption('');
  }
}
