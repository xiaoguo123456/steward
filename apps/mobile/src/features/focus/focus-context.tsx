import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { initialFocusRecords } from './mock-data';
import type { FocusRecord, NewFocusRecord } from './model';

type FocusPrototypeValue = {
  records: FocusRecord[];
  saveRecord: (record: NewFocusRecord) => void;
};

const FocusPrototypeContext = createContext<FocusPrototypeValue | null>(null);

export function FocusPrototypeProvider({ children }: PropsWithChildren) {
  const [records, setRecords] = useState<FocusRecord[]>(initialFocusRecords);

  const saveRecord = useCallback((record: NewFocusRecord) => {
    setRecords((current) => [
      {
        ...record,
        id: `focus-${Date.now()}-${current.length}`,
      },
      ...current,
    ]);
  }, []);

  const value = useMemo(() => ({ records, saveRecord }), [records, saveRecord]);

  return (
    <FocusPrototypeContext.Provider value={value}>
      {children}
    </FocusPrototypeContext.Provider>
  );
}

export function useFocusPrototype() {
  const value = useContext(FocusPrototypeContext);
  if (!value) {
    throw new Error('useFocusPrototype 必须在 FocusPrototypeProvider 中使用');
  }
  return value;
}
