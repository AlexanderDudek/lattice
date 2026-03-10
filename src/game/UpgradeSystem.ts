import { ResourceManager } from './ResourceManager';

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  cost: number;
  purchased: boolean;
  visible: boolean;
  phase: number;         // 1 or 2
  requires?: string[];   // prerequisite upgrade IDs
  effect: () => void;    // applied on purchase
}

export class UpgradeSystem {
  upgrades: Map<string, Upgrade> = new Map();
  private resources: ResourceManager;
  onPurchase?: (id: string) => void;

  // Game state flags set by upgrades
  affinityRadius = 0;        // 0 = off, 2 = active
  resonanceActive = false;
  subdivisionCount = 2;      // how many children on split
  patternRecognition = false;
  abstractionUnlocked = false;
  patternCompletionUnlocked = false;
  parallelProcessing = false;
  attentionMechanism = false;
  growthRateMultiplier = 1;
  pruningEfficiency = 1;
  resonanceCascade = false;

  constructor(resources: ResourceManager) {
    this.resources = resources;
    this.initUpgrades();
  }

  private initUpgrades(): void {
    const add = (u: Omit<Upgrade, 'purchased' | 'visible' | 'effect'> & { effect: () => void }) => {
      this.upgrades.set(u.id, { ...u, purchased: false, visible: false });
    };

    // Phase 1 upgrades
    add({
      id: 'affinity',
      name: 'Affinity',
      description: 'Nodes within 2 spaces auto-connect',
      cost: 30,
      phase: 1,
      effect: () => { this.affinityRadius = 2; },
    });

    add({
      id: 'resonance',
      name: 'Resonance',
      description: 'Connected clusters pulse in sync',
      cost: 50,
      phase: 1,
      effect: () => { this.resonanceActive = true; },
    });

    add({
      id: 'subdivision2',
      name: 'Subdivision II',
      description: 'Split nodes into 3 instead of 2',
      cost: 80,
      phase: 1,
      effect: () => { this.subdivisionCount = 3; },
    });

    add({
      id: 'patternRecognition',
      name: 'Pattern Recognition I',
      description: 'Adjacent nodes auto-link when similar',
      cost: 120,
      phase: 1,
      effect: () => { this.patternRecognition = true; },
    });

    // Phase 2 upgrades
    add({
      id: 'abstractionEngine',
      name: 'Abstraction Engine',
      description: 'Compress clusters into meta-nodes',
      cost: 200,
      phase: 2,
      effect: () => { this.abstractionUnlocked = true; },
    });

    add({
      id: 'patternCompletion',
      name: 'Pattern Completion',
      description: 'Auto-fill gaps (80% accurate)',
      cost: 350,
      phase: 2,
      requires: ['patternRecognition'],
      effect: () => { this.patternCompletionUnlocked = true; },
    });

    add({
      id: 'parallelProcessing',
      name: 'Parallel Processing',
      description: 'Split into threads. More throughput, possible contradictions',
      cost: 500,
      phase: 2,
      requires: ['abstractionEngine'],
      effect: () => { this.parallelProcessing = true; this.resources.compute.rate *= 1.5; },
    });

    add({
      id: 'attention',
      name: 'Attention Mechanism',
      description: 'Direct growth toward specific clusters',
      cost: 400,
      phase: 2,
      effect: () => { this.attentionMechanism = true; },
    });

    add({
      id: 'growthRate1',
      name: 'Growth Rate I',
      description: '2× autonomous growth speed',
      cost: 150,
      phase: 2,
      effect: () => { this.growthRateMultiplier = 2; },
    });

    add({
      id: 'growthRate2',
      name: 'Growth Rate II',
      description: '4× autonomous growth speed',
      cost: 600,
      phase: 2,
      requires: ['growthRate1'],
      effect: () => { this.growthRateMultiplier = 4; },
    });

    add({
      id: 'growthRate3',
      name: 'Growth Rate III',
      description: '8× autonomous growth speed',
      cost: 2000,
      phase: 2,
      requires: ['growthRate2'],
      effect: () => { this.growthRateMultiplier = 8; },
    });

    add({
      id: 'pruningEfficiency1',
      name: 'Pruning Efficiency I',
      description: 'Pruning removes 2× Entropy',
      cost: 250,
      phase: 2,
      effect: () => { this.pruningEfficiency = 2; },
    });

    add({
      id: 'pruningEfficiency2',
      name: 'Pruning Efficiency II',
      description: 'Pruning removes 4× Entropy',
      cost: 800,
      phase: 2,
      requires: ['pruningEfficiency1'],
      effect: () => { this.pruningEfficiency = 4; },
    });

    add({
      id: 'resonanceCascade',
      name: 'Resonance Cascade',
      description: 'Connected clusters amplify Clarity exponentially',
      cost: 5000,
      phase: 2,
      requires: ['resonance', 'abstractionEngine'],
      effect: () => { this.resonanceCascade = true; },
    });
  }

  updateVisibility(phase: number, nodeCount: number): void {
    for (const upgrade of this.upgrades.values()) {
      if (upgrade.purchased) continue;
      if (upgrade.phase > phase) { upgrade.visible = false; continue; }

      // Check prerequisites
      if (upgrade.requires) {
        const metPrereqs = upgrade.requires.every(req => this.upgrades.get(req)?.purchased);
        if (!metPrereqs) { upgrade.visible = false; continue; }
      }

      // Phase 1 upgrades visible after a few nodes
      if (upgrade.phase === 1) {
        upgrade.visible = nodeCount >= 3;
      } else {
        upgrade.visible = true;
      }
    }
  }

  canPurchase(id: string): boolean {
    const upgrade = this.upgrades.get(id);
    if (!upgrade || upgrade.purchased || !upgrade.visible) return false;
    return this.resources.canAfford(upgrade.cost);
  }

  purchase(id: string): boolean {
    if (!this.canPurchase(id)) return false;
    const upgrade = this.upgrades.get(id)!;
    this.resources.spend(upgrade.cost);
    upgrade.purchased = true;
    upgrade.effect();
    this.onPurchase?.(id);
    return true;
  }

  getVisibleUpgrades(): Upgrade[] {
    return Array.from(this.upgrades.values()).filter(u => u.visible && !u.purchased);
  }

  serialize(): string[] {
    return Array.from(this.upgrades.values()).filter(u => u.purchased).map(u => u.id);
  }

  deserialize(purchasedIds: string[]): void {
    for (const id of purchasedIds) {
      const upgrade = this.upgrades.get(id);
      if (upgrade) {
        upgrade.purchased = true;
        upgrade.effect();
      }
    }
  }
}
