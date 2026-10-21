import { createBottle, bottleIcon } from './bottle.js';
import { createPack, createBuns, createHotdogs, createHotdogInBun, ICONS } from './food.js';

// Everything the game needs to know about each kind of item.
//   name(item)    label for prompts and the hotbar
//   create(item)  mesh { group, refresh(item) }
//   price         store price in dollars (store items only)
//   hunger        what eating one restores, by quality (food only)
//   stack         items of the same kind (and quality) merge into one hotbar slot
//   handScale     shrink bulky things so they don't fill the first-person view
export const KINDS = {
  bottle: {
    name: () => 'water bottle',
    icon: (item) => bottleIcon(item.water),
    create: () => {
      const m = createBottle();
      return { group: m.group, refresh: (item) => m.setLevel(item.water) };
    },
  },
  hotdogs: {
    name: () => 'hot dogs',
    title: 'pack of hot dogs',
    price: 6,
    count: 6,
    icon: ICONS.hotdogs,
    create: createPack,
    raw: true,
    handScale: 0.75,
  },
  buns: {
    name: () => 'hot dog buns',
    title: 'bag of hot dog buns',
    price: 4,
    count: 8,
    icon: ICONS.buns,
    create: createBuns,
    hunger: { plain: 6 },
    handScale: 0.6,
  },
  hotdog: {
    name: (item) => `${item.quality === 'burnt' ? 'burnt ' : ''}hot dog`,
    icon: ICONS.hotdog,
    create: createHotdogs,
    hunger: { cooked: 12, burnt: 6 },
    stack: true,
  },
  hotdogInBun: {
    name: (item) => `${item.quality === 'burnt' ? 'burnt ' : ''}hot dog in a bun`,
    icon: ICONS.hotdogInBun,
    create: createHotdogInBun,
    hunger: { cooked: 25, burnt: 15 },
    stack: true,
  },
};

// Hotbar label + icon, with a count badge and an unpaid tag.
export function describeItem(item) {
  const kind = KINDS[item.kind];
  const count = item.count > 1 || kind.count ? ` (${item.count})` : '';
  const water = item.kind === 'bottle' ? ` (${Math.round(item.water * 100)}%)` : '';
  const name = kind.name(item);
  return {
    name: `${name[0].toUpperCase()}${name.slice(1)}${count}${water}${item.unpaid ? ' · unpaid' : ''}`,
    icon: kind.icon(item)
      + (item.count > 1 ? `<span class="slot-count">${item.count}</span>` : '')
      + (item.unpaid ? '<span class="slot-unpaid">$</span>' : ''),
  };
}
