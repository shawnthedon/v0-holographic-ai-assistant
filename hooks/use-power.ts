'use client';

import { useEffect, useState } from 'react';
import { getGovernor, type GovernorState } from '@/lib/perf/governor';

/**
 * Subscribe to the power governor.
 *
 * Components use this to decide *how* to draw, not *whether* to draw: the
 * profile lowers frame budgets and pauses ambient motion, it never removes a
 * feature or a reading.
 */
export function usePower(): GovernorState {
  const [state, setState] = useState<GovernorState>(() => getGovernor().getState());

  useEffect(() => {
    const unsubscribe = getGovernor().subscribe(setState);
    // The provider starts the governor; if this component mounts first, starting
    // it here is idempotent and avoids a first render with a stale profile.
    void getGovernor().start();
    return unsubscribe;
  }, []);

  return state;
}
