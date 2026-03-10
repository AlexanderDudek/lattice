import { UpgradeSystem, Upgrade } from '../game/UpgradeSystem';
import { ResourceManager } from '../game/ResourceManager';

export class UpgradePanel {
  private container: HTMLDivElement;
  private buttons: Map<string, HTMLButtonElement> = new Map();

  onPurchase?: (id: string) => void;

  constructor(uiLayer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'upgrade-panel';
    uiLayer.appendChild(this.container);
  }

  show(): void {
    this.container.classList.add('visible');
  }

  update(upgrades: UpgradeSystem, resources: ResourceManager): void {
    const visible = upgrades.getVisibleUpgrades();

    // Remove buttons for upgrades no longer visible
    for (const [id, btn] of this.buttons) {
      if (!visible.find(u => u.id === id)) {
        btn.remove();
        this.buttons.delete(id);
      }
    }

    // Add/update buttons
    for (const upgrade of visible) {
      let btn = this.buttons.get(upgrade.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.addEventListener('click', () => this.onPurchase?.(upgrade.id));
        this.container.appendChild(btn);
        this.buttons.set(upgrade.id, btn);
      }

      btn.disabled = !upgrades.canPurchase(upgrade.id);
      btn.innerHTML = `
        ${upgrade.name}<br/>
        <span class="cost">${upgrade.description} · ${resources.formatValue(upgrade.cost)} Clarity</span>
      `;
    }
  }
}
