import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from 'react';

import { memoryPrototypeFixtures } from './memory-fixtures';
import type { MemoryMoment } from './memory-model';

type MemoryMomentInput = Omit<MemoryMoment, 'id' | 'origin'> & { id?: string };

type MemoriesPrototypeValue = {
  moments: MemoryMoment[];
  addMoment: (input: MemoryMomentInput) => string;
  updateMoment: (id: string, input: MemoryMomentInput) => void;
  deleteMoment: (id: string) => void;
};

const MemoriesPrototypeContext = createContext<MemoriesPrototypeValue | null>(null);

export function MemoriesPrototypeProvider({ children }: PropsWithChildren) {
  const [moments, setMoments] = useState<MemoryMoment[]>(memoryPrototypeFixtures);

  const value = useMemo<MemoriesPrototypeValue>(() => ({
    moments,
    addMoment(input) {
      const id = input.id ?? `memory-local-${Date.now()}`;
      setMoments((current) => [{ ...input, id, origin: 'local' }, ...current]);
      return id;
    },
    updateMoment(id, input) {
      setMoments((current) => current.map((moment) => (
        moment.id === id ? { ...moment, ...input, id } : moment
      )));
    },
    deleteMoment(id) {
      setMoments((current) => current.filter((moment) => moment.id !== id));
    },
  }), [moments]);

  return (
    <MemoriesPrototypeContext.Provider value={value}>
      {children}
    </MemoriesPrototypeContext.Provider>
  );
}

export function useMemoriesPrototype(): MemoriesPrototypeValue {
  const value = useContext(MemoriesPrototypeContext);
  if (!value) throw new Error('useMemoriesPrototype 必须在 MemoriesPrototypeProvider 内使用');
  return value;
}
