import { SideEffectEntry } from '../game/SideEffects';

export class SideEffectsLog {
  private container: HTMLDivElement;

  constructor(uiLayer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'side-effects-log';
    uiLayer.appendChild(this.container);
  }

  show(): void {
    this.container.classList.add('visible');
  }

  addEntry(entry: SideEffectEntry): void {
    const el = document.createElement('div');
    el.className = 'side-effect-entry';
    el.innerHTML = `${entry.text}${entry.bonus ? ` <span class="bonus">${entry.bonus}</span>` : ''}`;
    this.container.appendChild(el);

    // Keep only last 8 entries visible
    while (this.container.children.length > 8) {
      this.container.removeChild(this.container.firstChild!);
    }

    // Auto-scroll to bottom
    this.container.scrollTop = this.container.scrollHeight;
  }
}
