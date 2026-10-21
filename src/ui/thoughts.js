// Thought bubble near the top of the screen for the character's inner voice.
const bubble = document.getElementById('thought');
const text = bubble.querySelector('.thought-text');
let hideTimer;

// Shows a thought. With a duration (seconds) it fades by itself; without one it stays until hidden.
export function think(message, duration) {
  clearTimeout(hideTimer);
  text.textContent = message;
  bubble.classList.add('on');
  if (duration) hideTimer = setTimeout(() => bubble.classList.remove('on'), duration * 1000);
}

export function stopThinking() {
  clearTimeout(hideTimer);
  bubble.classList.remove('on');
}

// Hygiene lines, said once each as hygiene drops past the threshold; the last one stays up.
const HYGIENE_THOUGHTS = [
  [30, "What's that smell? Oh! It's me..."],
  [20, 'Did I hit a skunk? Oh wait, no, that’s still me...'],
  [10, 'Okay, I should really take a shower before this van becomes a biohazard.'],
  [0, 'I really need to take a shower...'],
];

export class HygieneThoughts {
  constructor() {
    this.said = new Set();
    this.stuck = false; // the 0% thought is showing
  }

  update(hygiene) {
    // Showering (or anything that raises hygiene) re-arms the thoughts above it
    for (const [level] of HYGIENE_THOUGHTS) if (hygiene > level) this.said.delete(level);
    if (this.stuck && hygiene > 0) {
      this.stuck = false;
      stopThinking();
    }
    for (const [level, line] of HYGIENE_THOUGHTS) {
      const reached = level === 0 ? hygiene <= 0 : hygiene <= level;
      if (!reached || this.said.has(level)) continue;
      this.said.add(level);
      if (level === 0) {
        this.stuck = true;
        think(line);
      } else {
        think(line, 6);
      }
    }
  }
}
