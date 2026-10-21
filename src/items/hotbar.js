// Row of item slots along the bottom of the screen. The selected slot's item is the one in your
// hand. Items are plain objects ({ kind, ... }); `describe(item)` gives { name, icon } for display.

export class Hotbar {
  constructor(root, describe, size = 5) {
    this.root = root;
    this.describe = describe;
    this.slots = new Array(size).fill(null);
    this.selected = 0;
    this.cells = this.slots.map((_, i) => {
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.innerHTML = `<span class="slot-key">${i + 1}</span><div class="slot-icon"></div>`;
      root.appendChild(cell);
      return cell;
    });
    this.render();
  }

  get held() {
    return this.slots[this.selected];
  }

  get full() {
    return !this.slots.includes(null);
  }

  // Puts an item in the selected slot if it's free, otherwise the first free one, and selects it
  // so the item ends up in your hand. Returns false when there's no room.
  add(item) {
    const i = this.held ? this.slots.indexOf(null) : this.selected;
    if (i < 0) return false;
    this.slots[i] = item;
    this.selected = i;
    this.render();
    return true;
  }

  remove(item) {
    const i = this.slots.indexOf(item);
    if (i >= 0) this.slots[i] = null;
    this.render();
  }

  select(i) {
    this.selected = (i + this.slots.length) % this.slots.length;
    this.render();
  }

  render() {
    this.cells.forEach((cell, i) => {
      const item = this.slots[i];
      cell.classList.toggle('selected', i === this.selected);
      const info = item && this.describe(item);
      cell.querySelector('.slot-icon').innerHTML = info ? info.icon : '';
      cell.title = info ? info.name : '';
    });
  }
}
