import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

export function useClientReady() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
