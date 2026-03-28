import { LlamaContext } from 'llama.rn';

class BrainStore {
  db: any = null;
  embedContext: LlamaContext | null = null;
}

export const brainStore = new BrainStore();
