'use client';

import { useState, useEffect, useCallback } from 'react';
import { validateSession, endSession, getWalletAddress } from './api';

export function useAuth() {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const result = await validateSession();
      setAddress(result.address);
    } catch {
      setAddress(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Quick check from localStorage first for instant UI
    const stored = getWalletAddress();
    if (stored) setAddress(stored);

    // Then validate with the gateway
    checkSession();
  }, [checkSession]);

  const disconnect = useCallback(async () => {
    try {
      // The gateway clears the httpOnly session cookie on this call.
      await endSession();
    } catch {
      // Even if the API call fails, clear local state
    }
    setAddress(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('x402-wallet-address');
    }
  }, []);

  return { address, loading, isConnected: !!address, disconnect, refresh: checkSession };
}
