import { Morphology } from './Morphology';
import { pluck } from './pluck';
import { drone } from './drone';
import { sequencer } from './sequencer';
import { bells } from './bells';

export const morphologies: Morphology[] = [pluck, drone, sequencer, bells];

export function getMorphology(id: string): Morphology | undefined {
  return morphologies.find(m => m.id === id);
}
