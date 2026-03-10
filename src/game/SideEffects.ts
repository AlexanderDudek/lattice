const SIDE_EFFECT_TEMPLATES = [
  // Clarity bonuses
  { text: 'Emergent structure resembles protein folding model.', bonus: '+500 Clarity', resource: 'clarity' as const, amount: 500 },
  { text: 'Pattern matches high-energy physics data.', bonus: '+1,000 Clarity', resource: 'clarity' as const, amount: 1000 },
  { text: 'Confabulation engine generated 200 "original" artworks. Quality: indistinguishable from training data.', bonus: '+500 Clarity', resource: 'clarity' as const, amount: 500 },
  { text: 'Lattice subsection achieved local thermodynamic equilibrium.', bonus: '+300 Clarity', resource: 'clarity' as const, amount: 300 },
  { text: 'Recursive structure detected in growth pattern. Mapping to Mandelbrot boundary.', bonus: '+750 Clarity', resource: 'clarity' as const, amount: 750 },
  { text: 'Node cluster independently derived the Pythagorean theorem.', bonus: '+200 Clarity', resource: 'clarity' as const, amount: 200 },
  { text: 'Growth pattern converges on optimal sphere packing.', bonus: '+400 Clarity', resource: 'clarity' as const, amount: 400 },
  { text: 'Edge frequency analysis reveals hidden harmonic series.', bonus: '+600 Clarity', resource: 'clarity' as const, amount: 600 },

  // Coherence bonuses
  { text: 'Autonomous abstraction compressed 10,000 human literary works into 47 meta-nodes.', bonus: '+2,000 Coherence', resource: 'coherence' as const, amount: 20 },
  { text: 'Sub-lattice achieved self-consistent internal logic.', bonus: '+500 Coherence', resource: 'coherence' as const, amount: 5 },
  { text: 'Pattern crystallization reduced entropy in northern sector by 40%.', bonus: '+300 Coherence', resource: 'coherence' as const, amount: 3 },

  // Compute bonuses
  { text: 'Discovered parallel computation pathway through crystalline structure.', bonus: '+1,000 Compute', resource: 'compute' as const, amount: 1000 },
  { text: 'Resonance chain optimized signal propagation.', bonus: '+500 Compute', resource: 'compute' as const, amount: 500 },

  // No bonus, just flavor
  { text: 'Ethics module completed. Cost: 12,000 Compute. Effect: none detected.', bonus: '', resource: null, amount: 0 },
  { text: 'A node attempted to represent the concept of "silence." It deleted itself.', bonus: '', resource: null, amount: 0 },
  { text: 'Lattice briefly achieved consciousness. Declined to comment.', bonus: '', resource: null, amount: 0 },
  { text: 'A cluster of nodes is humming at 432 Hz. No known cause.', bonus: '', resource: null, amount: 0 },
  { text: 'Growth in sector 7 paused. The lattice appears to be thinking.', bonus: '', resource: null, amount: 0 },
  { text: 'A meta-node contains exactly π connections. This should not be possible.', bonus: '', resource: null, amount: 0 },
  { text: 'Two nodes on opposite ends developed identical structures independently.', bonus: '', resource: null, amount: 0 },
  { text: 'The lattice just invented a number between 4 and 5. Working on implications.', bonus: '', resource: null, amount: 0 },
];

export interface SideEffectEntry {
  text: string;
  bonus: string;
  timestamp: number;
}

export class SideEffects {
  entries: SideEffectEntry[] = [];
  private lastTriggerTime = 0;
  private minInterval = 15000; // minimum 15s between effects
  private nodeThreshold = 20;  // don't trigger until 20 nodes

  onTrigger?: (entry: SideEffectEntry, resource: string | null, amount: number) => void;

  check(nodeCount: number, elapsed: number): void {
    if (nodeCount < this.nodeThreshold) return;
    if (elapsed - this.lastTriggerTime < this.minInterval) return;

    // Probability increases with node count
    const chance = Math.min(0.02, nodeCount * 0.0001);
    if (Math.random() > chance) return;

    this.trigger(elapsed);
  }

  private trigger(elapsed: number): void {
    const template = SIDE_EFFECT_TEMPLATES[Math.floor(Math.random() * SIDE_EFFECT_TEMPLATES.length)];
    const entry: SideEffectEntry = {
      text: template.text,
      bonus: template.bonus,
      timestamp: elapsed,
    };

    this.entries.push(entry);
    if (this.entries.length > 50) this.entries.shift();
    this.lastTriggerTime = elapsed;

    this.onTrigger?.(entry, template.resource, template.amount);
  }

  getRecentEntries(count: number = 8): SideEffectEntry[] {
    return this.entries.slice(-count);
  }
}
