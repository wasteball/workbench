import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { FileDestination } from '@/shared/types';

export interface DestinationState {
  kind: FileDestination;
  label: string;
  detail: string;
}

const DEFAULT_DESTINATION: DestinationState = {
  kind: 'browser-draft',
  label: '本地工作台',
  detail: '数据保存在此浏览器',
};

interface DestinationContextValue {
  destination: DestinationState;
  setDestination: (next: DestinationState) => void;
  resetDestination: () => void;
}

const DestinationContext = createContext<DestinationContextValue | null>(null);

export function DestinationProvider({ children }: { children: React.ReactNode }) {
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const resetDestination = useCallback(() => setDestination(DEFAULT_DESTINATION), []);
  const value = useMemo(
    () => ({ destination, setDestination, resetDestination }),
    [destination, resetDestination],
  );
  return <DestinationContext.Provider value={value}>{children}</DestinationContext.Provider>;
}

export function useDestination(): DestinationContextValue {
  const value = useContext(DestinationContext);
  if (!value) throw new Error('useDestination must be used inside DestinationProvider');
  return value;
}
