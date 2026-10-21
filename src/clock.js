// In-game time. One real second is one game minute, so a game day lasts 24 real minutes.
export const GAME_MINUTES_PER_SECOND = 1;

export class GameClock {
  constructor(startHour = 8) {
    this.minutes = startHour * 60; // game minutes since midnight on day 1
  }

  advance(gameMinutes) {
    this.minutes += gameMinutes;
  }

  get hourOfDay() {
    return (this.minutes / 60) % 24;
  }

  // "Day 2 · 4:05 PM"
  label(minutes = this.minutes) {
    const day = Math.floor(minutes / 1440) + 1;
    return `Day ${day} · ${timeOfDay(minutes)}`;
  }
}

export function timeOfDay(minutes) {
  const m = Math.floor(minutes) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
