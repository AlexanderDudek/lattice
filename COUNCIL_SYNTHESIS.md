# Lattice Council Synthesis

**Session date:** 2026-03-21
**Panel:** Acoustic Architect, Topology Sculptor, Interaction Shaman, Emergence Designer, Visual Alchemist, Modular Synth Theorist, Ecosystem Ecologist

---

## Executive Summary

Seven domain experts analyzed Lattice's current state and vision across six strategic topics. The council reached consensus on sequencing and architecture, with key rulings on new morphologies, shared-space interaction, death mechanics, modular synth migration, progression pacing, and evolution.

**The single most important change:** Add an `onPostSplit` hook to the `Morphology` interface so morphologies can create edges between existing nodes. Without this, every network is a tree forever, and most interesting topology, sound, and gameplay is locked out.

---

## T1: New Morphologies — Rulings

### Priority Batch 1 (build now, current architecture)

**1. FM Synthesis — "MORPH"**
- Edges = modulator-carrier relationships. Network connectivity directly = timbral complexity.
- onTap: carrier sine + modulator at position-derived ratio. Mod index = intensity * 4.
- onSplit: new node starts at 1:1 ratio, drifts to target over 2s (glassy sweep).
- onPacketArrive: spikes modulation index briefly. More edges = more complex spectra.
- onUpdate: LFO on mod index tied to totalEnergy. Low energy = pure sine. High energy = metallic FM.
- Visual: SDF glyph (screen-facing quad with signed distance field shader). Morphable shapes.

**2. Karplus-Strong — "STRING"**
- Packets arriving = excitation burst. DelayNode with filtered feedback.
- Delay length = pitch (1/delayTime). Feedback gain 0.990-0.998 for long strings.
- Edge count of tapped node controls feedback filter cutoff (more connections = brighter).
- Connected strings share energy through GainNode coupling at 0.05 — sympathetic resonance.
- Strings ring 3-8 seconds (vs pluck's 0.35s). Slow, contemplative morphology.
- Visual: wireframe skeleton (EdgesGeometry + animated edge brightness).

**3. Sacrifice — "FURNACE"**
- First morphology where you tap to DESTROY, not grow.
- Killing a node feeds all connected neighbors with its accumulated energy.
- The interesting choice: grow it or burn it to accelerate others?
- Creates sparse, high-energy networks instead of dense low-energy ones.
- Sound: descending tone resolving into harmonic richness on remaining nodes.
- Visual: embers/particle cloud (InstancedMesh of tiny spheres orbiting center).

### Priority Batch 2 (requires shared-space)

**4. Parasite — "LEECH"**
- Cannot grow on its own. Intercepts packets from adjacent organisms.
- Sound: distorted, pitch-shifted echoes of the host's sound.
- Creates first real inter-organism dependency.

**5. Decomposer — "MYCELIUM"**
- Feeds on dead/dying nodes. Converts husks into its own network.
- Sound: deep sub-bass rumble, processed reverb tails of consumed sounds.
- Closes the nutrient cycle. Required foundation for death ecology.

### Priority Batch 3 (requires persistent audio)

**6. Feedback — "FEEDBACK"**
- Self-oscillating delay lines. Unpredictable, alive, potentially chaotic.
- Safety: hard-clip output + DynamicsCompressorNode before master.

### Prerequisite Code Change

Add to `Morphology` interface:
```typescript
onPostSplit?(state: InstrumentState, parent: LatticeNode, child: LatticeNode): void;
```

Call from `Instrument.ts` after line 306. This enables:
- **Cycle Former**: new node searches for nearby non-parent node, creates second edge
- **Hub Builder**: preferential attachment (connect to highest-degree neighbor)
- **Bridge Weaver**: bias growth toward distant subgraphs

---

## T2: Shared-Space Interaction — Rulings

### Three-phase rollout

**Phase 1: Spatial competition (no direct interaction)**
- Nodes cannot be placed within 0.8 units of a foreign node.
- Growth blocked by proximity. Fast growers claim territory; dense growers resist invasion.
- Implementation: proximity check in `splitNode`.

**Phase 2: Boundary edges with behavioral effects**
- When nodes from different morphologies are within 1.5 units, a boundary edge forms.
- Boundary edges are visually distinct (different color, dashed).
- Interaction matrix (rock-paper-scissors):

```
           pluck    drone    sequencer   bells
pluck        —      compete   compete    mutualism
drone     compete     —      mutualism   compete
sequencer compete  mutualism     —       mutualism
bells     mutualism compete  mutualism      —
```

- Mutualism: shared packet energy, harmonically related sounds.
- Competition: denser local network wins the energy.
- Diversity bonus: tap energy multiplied by number of living species.

**Phase 3: Audio cross-patching (requires persistent node audio)**
- Drone's LFO modulates Pluck's filter cutoff via `AudioNode.connect(AudioParam)`.
- Sequencer's clock triggers Bell's envelope via event connections.
- Cross-connections managed in `Map<string, AudioNode>` with distance hysteresis (connect at 1.5, disconnect at 2.5).

### Architecture requirement

New `SharedSpace` class holding multiple `Instrument` instances. Cross-instrument proximity checks each frame. Global node ID space or `{instrumentId, nodeId}` pairs.

### Feel requirements (Interaction Shaman)
- Cursor proximity feedback per morphology (shimmer/pulse/glow/drift).
- Differentiated screen shake per morphology in merged view.
- Overlap zones: equidistant cursor shows both feedbacks at 0.5 intensity.

---

## T3: Life/Death — Rulings

### Two modes mirroring life mechanic

**Right-click TAP = instant death**
- Node dies immediately with 4-phase audio cascade:
  1. Filter close (0-200ms): cutoff sweeps to 20 Hz
  2. Pitch drop (0-500ms): detune -2400 cents (two octaves down)
  3. Granular dissolution (200-1500ms): rapid gain gating 4→40 Hz
  4. Ghost reverb tail (500-3000ms): long ConvolverNode, space remembers the sound
- Visual: crack (noise displacement) → drain (ring empties reverse) → collapse (scale to 0, ease-in-cubic) → void particles (inward drift) → ghost afterimage
- Death sounds use SAME synthesis method as the morphology's life sounds
- Screen shake: lower magnitude than life, slower decay (rumble not snap)
- Bloom briefly DIPS (anti-flash)

**Right-click HOLD = continuous drain**
- Energy drain -0.3/s on target + neighbors while held
- Drain propagates weakly through network (50% reduction per hop)
- Node enters stressed → dying → dead → husk → decomposed lifecycle
- Surgical pruning tool for shaping topology

### Death as fertilizer
- Dead nodes release energy burst to all nodes within radius 2.0
- Energy proportional to generation cost (high-gen deaths are powerful)
- "Soil fertility" grid: decomposition increases local fertility, boosts future growth
- Creates succession cycles: death → fertile ground → rapid recolonization

### Bridge/cut-vertex detection
- Tarjan's algorithm (O(V+E), trivial for <100 nodes)
- Right-clicking a cut-vertex splits the graph — dramatic cascade
- Orphaned components drift outward, emit descending tones, then fade

### Code requirements
- `uDeath` uniform in node shader (crack/collapse animation)
- `uRippleDirection` uniform for inward ripple
- Death cursor: dark vortex shader around mouse on right-click hold
- `onDeath?(state, node)` on Morphology interface

---

## T4: Modular Synth Migration — Rulings

### Phase 1: Persistent Node Audio (prerequisite for everything)

Each `LatticeNode` gets a persistent audio subgraph:
```typescript
interface NodeAudio {
  source: OscillatorNode | AudioBufferSourceNode;
  filter: BiquadFilterNode;
  amp: GainNode;
  output: GainNode; // patch point for edge connections
}
```

- Oscillator runs continuously. Output gain starts at 0.
- Events (tap, packet arrival) manipulate parameters on persistent nodes.
- Performance budget: ~50 active audio voices (source+filter+gain = 3-4 AudioNodes each, Chrome handles ~200 total).
- Gracefully mute lowest-energy nodes beyond 64 cap.

New `MorphologyAudio` methods:
```typescript
onEdgeCreated?(fromId: number, toId: number): void;
onEdgeDestroyed?(fromId: number, toId: number): void;
onNodeCreated?(nodeId: number, pos: Vector3, gen: number): void;
onNodeDestroyed?(nodeId: number): void;
```

### Phase 2: Edge Audio Routing

Edges become `AudioNode.connect()` calls with GainNode intermediary:
```
sourceNode.output -> EdgeGain -> targetNode.filter (or input)
```

- EdgeGain modulated by packet traffic (active edges let signal through, idle edges muted).
- Packets literally carry the signal — visual packet activity = audio routing intensity.

### Phase 3: Node Type Specialization

Generation maps to node type:
- Gen 0-1: Generator (oscillator, noise source)
- Gen 2-3: Filter (lowpass, bandpass, highpass — determined by position)
- Gen 4+: Effect (delay, distortion, reverb)

Topology determines role:
- Source (degree 0 incoming): generates signal
- Sink (degree 0 outgoing): outputs to speakers
- Bridge: serial processor
- Hub (high degree): mixer

### Phase 4: Cross-Morphology Patching

Builds on Phase 2 + shared-space Phase 3. Same `.connect()` architecture with proximity-based GainNodes. No new infrastructure needed.

### Discovery path (no tutorials)
1. Packets already carry energy along edges (player understands "edges are paths")
2. At ~10 nodes: hold-to-drag discovers edge creation (300ms threshold separates from tap)
3. Signal packets appear (visually distinct) — they trigger sound, not energy
4. Node roles emerge from topology — player discovers gates, filters, mixers through interaction

---

## T5: Progression & Revelation — Rulings

### Visual progression (start minimal)

| Phase | Trigger | Visual State |
|-------|---------|-------------|
| 0 | Start | No bloom. Muted color. MeshBasicMaterial. Breathing animation only. |
| 1 | First split | Bloom ACTIVATES (slam to 2.0, decay to base over 3s). Custom shaders engage. Color enters. Energy rings appear. |
| 2 | 4-8 nodes | Edge animations visible. Packets gain custom geometry. Background hue-shifts. |
| 3 | 16+ nodes | Screen shake unlocks. Morphology-specific behaviors activate. |
| 4 | 32+ nodes | Chromatic aberration + vignette post-processing layers. |

### Morphology appearance sequence

| Trigger | Event |
|---------|-------|
| Start | Pluck only (most immediately gratifying) |
| 5 nodes | Drone appears at edge of space (no announcement) |
| 8 total | Sequencer appears |
| 12 total | Bells appears |
| 20 total | Merged view becomes available |

### Topological milestone triggers (supplement node-count)

| Metric | Value | Unlock |
|--------|-------|--------|
| First cycle | edges >= nodes | Cycle-based sonification, looping packets |
| Clustering > 0.3 | ~10 nodes | Wave propagation features |
| Max degree > 5 | ~15 nodes | Hub-based routing |
| First component split | After death | Independent voice channels |

### Revelation feel principles
- Pre-split: node breathes (0.4Hz scale oscillation, amplitude 0.03). First hover: micro-bounce + soft chime.
- At 75% energy: position jitter begins. At 90%: continuous faint tone rises. Physical anticipation.
- First packet: 2x normal size, 0.5x speed. Make the player WATCH it travel.
- Hold-to-tap: first 3 taps require discrete clicks. 4th mousedown triggers autotap with distinct visual.
- Death discovery: after 8+ nodes, one "overfull" node strains visually. Right-click discovered by curiosity.
- Each new mechanic announces itself through a BREAK in established visual rhythm.

### Generation milestones
- At gen 4 (splitCost 64): background permanently shifts color + new ambient sound layer.
- Each first-of-generation split: burst of packets to all nodes + temporary energy multiplier.

---

## T6: Evolution — Rulings

### Timing
- Late game only (hour 5+). Never before shared-space and death are working.
- Never quantified to the player. No fitness numbers, generation counters, or evolution UI.
- Felt through gradual visual/sonic drift punctuated by rare mutation moments.

### Genome (20 floats)

```typescript
interface MorphologyGenome {
  // Growth (5)
  splitCostBase: number;       // 2-8
  splitCostScaling: number;    // 1.5-3.0
  growthBias: number;          // 0-1
  passiveEnergyRate: number;   // 0-0.02
  edgeFormationRadius: number; // 0-3.0

  // Packets (5)
  packetBounceChance: number;  // 0-0.6
  packetSpeed: number;         // 0.1-1.5
  packetEnergyGain: number;    // 0.1-0.8
  ambientPacketRate: number;   // 0-0.1
  autoSplitOnPacket: number;   // boolean threshold 0.5

  // Audio (6)
  baseFreq: number;            // 55-880
  oscillatorType: number;      // 0-3 (sine/triangle/saw/square)
  attackTime: number;          // 0.001-0.1
  decayTime: number;           // 0.05-4.0
  filterFreq: number;          // 200-8000
  filterQ: number;             // 0.5-10

  // Visual (4)
  hueBase: number;             // 0-1
  colorShiftRate: number;      // -0.05 to 0.05
  nodeScale: number;           // 0.15-0.5
  bloomStrength: number;       // 0.5-2.0
}
```

### Fitness function
```
fitness = 0.7 * (taps_received / time_alive / sqrt(node_count))
        + 0.3 * boundary_participation
```

Player behavior IS the fitness function. No acoustic analysis for selection.

### Mutation validation (Acoustic Architect's guards)
- RMS check via AnalyserNode: reject if < 0.01 or > 0.5
- Spectral balance: reject if >80% energy above 4kHz or >90% below 100Hz
- Offline audition: 200ms in OfflineAudioContext, reject if peak > 0.95 (clipping) or < -60dB (silence)
- Pitch mutations quantized to semitones

### Selection mechanism
- Steady-state tournament (k=3) with spatial locality
- Every 30s: lowest-fitness organism replaced by offspring of two nearby high-fitness parents
- Fitness sharing: similar genomes divide fitness (prevents convergence)
- 1% macro-mutation chance, 0.1% horizontal gene transfer

### Feel of evolution
- **Gradual drift**: color hue shifts 0.001/s based on tap patterns. Audio base frequency drifts +/-0.5 semitones/min based on topology density.
- **Mutation moments** (at power-of-2 node counts or new generation firsts): 500ms phase shift — desaturation, deep tone, synchronized pulse, bloom color temp shift.
- **Emergent identity**: symmetry in tap patterns → symmetric growth. Chaos in taps → chaotic packets. 2-3 minute lag on behavior mapping (organism has inertia).

---

## Implementation Sequence

The council's recommended order, respecting dependencies:

1. **`onPostSplit` hook + cycle formation** — unlocks topological diversity
2. **FM + Karplus-Strong + Furnace morphologies** — Batch 1, current architecture
3. **Visual progression** — start minimal, bloom on first split
4. **Revelation pacing** — sequential morphology appearance, affordance system
5. **Death mechanics** — tap + hold modes, 4-phase audio death, fertilizer
6. **Shared-space Phase 1** — spatial competition (proximity blocking)
7. **Shared-space Phase 2** — boundary edges, interaction matrix
8. **Persistent node audio** — Phase 1 of modular synth migration
9. **Parasite + Decomposer morphologies** — Batch 2
10. **Edge audio routing** — Phase 2 of modular synth
11. **Node type specialization** — Phase 3 of modular synth
12. **Evolution system** — late game, requires stable ecosystem
13. **Cross-morphology audio patching** — Phase 4 of modular synth

---

## Key Architecture Changes Required

| File | Change |
|------|--------|
| `src/morphologies/Morphology.ts` | Add: `onPostSplit`, `onDeath`, `onHoldStart/Update/Release`, `onForeignProximity`, `shakeProfile`, `createNodeMaterial?`, `createEdgeMaterial?` |
| `src/engine/types.ts` | Add to `LatticeNode`: `role`, `nodeAudio`, `velocity`, `health state`. Add `NodeAudio` interface. Expand `VisualProfile` with optional custom material factories. |
| `src/engine/Instrument.ts` | Make `splitNode` call `onPostSplit`. Add death handling. Add visual phase gating. Expand shake to support per-morphology profiles. |
| `src/engine/audio.ts` | Add lifecycle hooks: `onNodeCreated`, `onNodeDestroyed`, `onEdgeCreated`, `onEdgeDestroyed`. |
| `src/engine/shaders.ts` | Add `uDeath`, `uRippleDirection` uniforms. Support per-morphology shader override. |
| `src/engine/meshes.ts` | Support optional `createMaterial` from morphology profile. |
| NEW: `src/engine/SharedSpace.ts` | Cross-instrument proximity checks, boundary edges, interaction matrix, fertility grid. |
