import { Morphology } from './Morphology';
import { pluck } from './pluck';
import { drone } from './drone';
import { sequencer } from './sequencer';
import { bells } from './bells';
import { fm } from './fm';
import { string } from './string';
import { furnace } from './furnace';
import { beats } from './beats';

export const morphologies: Morphology[] = [pluck, drone, sequencer, bells, fm, string, furnace, beats];

export function getMorphology(id: string): Morphology | undefined {
  return morphologies.find(m => m.id === id);
}
