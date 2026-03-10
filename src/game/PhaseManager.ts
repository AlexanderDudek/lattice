export type GamePhase = 'prompt' | 'phase1' | 'phase1_patterns' | 'phase2';

export interface PhaseTransition {
  from: GamePhase;
  to: GamePhase;
  progress: number;  // 0-1
  active: boolean;
}

export class PhaseManager {
  currentPhase: GamePhase = 'prompt';
  transition: PhaseTransition = { from: 'prompt', to: 'prompt', progress: 0, active: false };

  // Callbacks
  onPhaseChange?: (from: GamePhase, to: GamePhase) => void;

  // Thresholds
  private patternThreshold = 100;  // nodes for "Patterns Detected"
  private phase2Threshold = 150;   // nodes for full Phase 2

  checkTransitions(nodeCount: number): void {
    if (this.transition.active) return;

    if (this.currentPhase === 'phase1' && nodeCount >= this.patternThreshold) {
      this.startTransition('phase1', 'phase1_patterns');
    } else if (this.currentPhase === 'phase1_patterns' && nodeCount >= this.phase2Threshold) {
      this.startTransition('phase1_patterns', 'phase2');
    }
  }

  private startTransition(from: GamePhase, to: GamePhase): void {
    this.transition = { from, to, progress: 0, active: true };
  }

  updateTransition(dt: number): void {
    if (!this.transition.active) return;

    this.transition.progress += dt * 0.3; // transition takes ~3 seconds
    if (this.transition.progress >= 1) {
      this.transition.progress = 1;
      this.transition.active = false;
      const oldPhase = this.currentPhase;
      this.currentPhase = this.transition.to;
      this.onPhaseChange?.(oldPhase, this.currentPhase);
    }
  }

  completePrompt(): void {
    this.currentPhase = 'phase1';
    this.onPhaseChange?.('prompt', 'phase1');
  }

  isPhase2(): boolean {
    return this.currentPhase === 'phase2';
  }

  isPostPrompt(): boolean {
    return this.currentPhase !== 'prompt';
  }

  getGridAlpha(): number {
    // Grid fades during transition to phase 2
    if (this.currentPhase === 'phase2') return 0;
    if (this.transition.active && this.transition.to === 'phase2') {
      return 1 - this.transition.progress;
    }
    return 1;
  }
}
