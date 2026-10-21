// Scarcity meters, 0..100, drained in game hours (see clock.js).
export const NEEDS = [
  { key: 'energy', label: 'Energy', hoursToEmpty: 45 },
  { key: 'thirst', label: 'Thirst', hoursToEmpty: 12 },
  { key: 'hunger', label: 'Hunger', hoursToEmpty: 20 },
  { key: 'hygiene', label: 'Hygiene', hoursToEmpty: 90 },
  { key: 'fuel', label: 'Fuel', gauge: true }, // shown on the fuel gauge; drains with the engine
];

const FUEL_IDLE_HOURS = 150; // a full tank lasts this long idling
const FUEL_CRUISE_HOURS = 50; // ...and this long driving at highway speed
const HIGHWAY_SPEED = 26.8; // m/s (60 mph)

// Running on empty wears you out: energy drains this much faster at 0% hunger / thirst.
const STARVING_ENERGY_DRAIN = 1.5;
const DEHYDRATED_ENERGY_DRAIN = 5;

const SLEEP_ENERGY_PER_HOUR = 12.5; // 8 hours takes you from empty to full
const SLEEP_DRAIN_FACTOR = 0.5; // the body slows down while asleep

const STARTING_MONEY = 500;

const perHour = (hours) => 100 / hours;
const clamp = (v) => Math.min(Math.max(v, 0), 100);

export class Needs {
  constructor() {
    this.values = Object.fromEntries(NEEDS.map((n) => [n.key, 100]));
    this.money = STARTING_MONEY; // whole dollars
  }

  // How much faster than normal energy is draining right now.
  get energyDrainFactor() {
    return (this.values.hunger <= 0 ? STARVING_ENERGY_DRAIN : 1) * (this.values.thirst <= 0 ? DEHYDRATED_ENERGY_DRAIN : 1);
  }

  update(hours, { engineOn, speed }) {
    for (const n of NEEDS) {
      if (!n.hoursToEmpty) continue;
      const factor = n.key === 'energy' ? this.energyDrainFactor : 1;
      this.values[n.key] = clamp(this.values[n.key] - perHour(n.hoursToEmpty) * factor * hours);
    }
    if (engineOn) {
      const driving = Math.min(Math.abs(speed) / HIGHWAY_SPEED, 1);
      const idle = perHour(FUEL_IDLE_HOURS);
      const cruise = perHour(FUEL_CRUISE_HOURS);
      this.values.fuel = clamp(this.values.fuel - (idle + (cruise - idle) * driving) * hours);
    }
  }

  // What the meters would be after sleeping this many hours.
  previewSleep(hours) {
    const after = { ...this.values };
    for (const n of NEEDS) {
      if (n.key === 'energy') after.energy = clamp(after.energy + SLEEP_ENERGY_PER_HOUR * hours);
      else if (n.hoursToEmpty) after[n.key] = clamp(after[n.key] - perHour(n.hoursToEmpty) * hours * SLEEP_DRAIN_FACTOR);
    }
    return after;
  }

  // Hours of sleep it takes to get energy back up to a level.
  hoursToReach(energy) {
    return Math.max(0, (energy - this.values.energy) / SLEEP_ENERGY_PER_HOUR);
  }

  sleep(hours) {
    this.values = this.previewSleep(hours);
  }

  shower() {
    this.values.hygiene = 100;
  }
}

// Bar color stops [percent, r, g, b], blended linearly between neighbors.
const COLOR_STOPS = [
  [100, 0, 255, 0], // green
  [60, 255, 255, 0], // yellow (earlier than halfway, so bars warn sooner)
  [0, 255, 0, 0], // red
];

export function needColor(percent) {
  const v = Math.min(Math.max(percent, 0), 100);
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [p1, ...c1] = COLOR_STOPS[i];
    if (v < p1) continue;
    const [p0, ...c0] = COLOR_STOPS[i - 1];
    const t = (v - p1) / (p0 - p1);
    const [r, g, b] = c1.map((c, k) => Math.round(c + (c0[k] - c) * t));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return 'rgb(255, 0, 0)';
}
