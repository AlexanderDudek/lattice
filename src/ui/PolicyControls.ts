import { GrowthPolicy } from '../simulation/GrowthEngine';
import * as THREE from 'three';

export class PolicyControls {
  private container: HTMLDivElement;
  onChange?: (policy: Partial<GrowthPolicy>) => void;

  constructor(uiLayer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'policy-controls';
    uiLayer.appendChild(this.container);

    this.createSlider('Growth Rate', 'rate', 0, 1, 0.3, 0.05);
    this.createSlider('Connection Threshold', 'connectionThreshold', 0, 1, 0.5, 0.05);
    this.createSlider('Abstraction', 'abstractionAggression', 0, 1, 0.3, 0.05);

    // Direction bias dropdown-ish: use a slider for Y bias (up vs flat)
    this.createSlider('Growth Direction (↑)', 'directionY', -1, 1, 0.2, 0.1);
  }

  private createSlider(
    label: string,
    key: string,
    min: number,
    max: number,
    initial: number,
    step: number
  ): void {
    const group = document.createElement('div');
    group.className = 'policy-slider-group';

    const labelEl = document.createElement('div');
    labelEl.className = 'policy-label';
    labelEl.innerHTML = `<span>${label}</span><span class="policy-value" data-key="${key}">${initial.toFixed(2)}</span>`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'policy-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(initial);
    slider.step = String(step);

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      const valueDisplay = labelEl.querySelector(`[data-key="${key}"]`) as HTMLElement;
      if (valueDisplay) valueDisplay.textContent = value.toFixed(2);

      if (key === 'directionY') {
        this.onChange?.({ directionBias: new THREE.Vector3(0, value, 0) });
      } else {
        this.onChange?.({ [key]: value } as any);
      }
    });

    group.appendChild(labelEl);
    group.appendChild(slider);
    this.container.appendChild(group);
  }

  show(): void {
    this.container.classList.add('visible');
  }

  hide(): void {
    this.container.classList.remove('visible');
  }
}
