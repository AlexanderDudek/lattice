import { ResourceManager } from '../game/ResourceManager';

export class ResourceDisplay {
  private container: HTMLDivElement;
  private rows: Map<string, HTMLElement> = new Map();

  constructor(uiLayer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'resource-display';
    uiLayer.appendChild(this.container);
  }

  show(): void {
    this.container.classList.add('visible');
  }

  update(resources: ResourceManager, nodeCount: number): void {
    this.updateRow('nodes', 'Nodes', nodeCount.toString(), '');
    this.updateRow('clarity', 'Clarity', resources.formatValue(resources.clarity.value), resources.formatRate(resources.clarity.rate));
    this.updateRow('connections', 'Connections', resources.connections.value.toString(), '');

    if (resources.phase2Active) {
      this.updateRow('coherence', 'Coherence', Math.floor(resources.coherence.value).toString() + '%', resources.formatRate(resources.coherence.rate));
      this.updateRow('entropy', 'Entropy', Math.floor(resources.entropy.value).toString() + '%', resources.formatRate(resources.entropy.rate));
      this.updateRow('compute', 'Compute', resources.formatValue(resources.compute.value), resources.formatRate(resources.compute.rate));
    }
  }

  private updateRow(key: string, label: string, value: string, rate: string): void {
    let row = this.rows.get(key);
    if (!row) {
      row = document.createElement('div');
      row.className = 'resource-row';
      row.innerHTML = `
        <span class="resource-label">${label}</span>
        <span class="resource-value" data-key="${key}"></span>
        <span class="resource-rate" data-key="${key}-rate"></span>
      `;
      this.container.appendChild(row);
      this.rows.set(key, row);
    }

    const valueEl = row.querySelector(`[data-key="${key}"]`) as HTMLElement;
    const rateEl = row.querySelector(`[data-key="${key}-rate"]`) as HTMLElement;
    if (valueEl) valueEl.textContent = value;
    if (rateEl) rateEl.textContent = rate;
  }

  removeRow(key: string): void {
    const row = this.rows.get(key);
    if (row) {
      row.remove();
      this.rows.delete(key);
    }
  }
}
