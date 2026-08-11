/** @jest-environment jsdom */

import { setSessionToken, clearSessionToken, setWalletAddress, getWalletAddress } from './api';

describe('session token management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves the session token', () => {
    setSessionToken('test-token-123');
    expect(localStorage.getItem('x402-session-token')).toBe('test-token-123');
  });

  it('clears the session token and wallet address', () => {
    localStorage.setItem('x402-session-token', 'token');
    localStorage.setItem('x402-wallet-address', 'GABC...');
    clearSessionToken();
    expect(localStorage.getItem('x402-session-token')).toBeNull();
    expect(localStorage.getItem('x402-wallet-address')).toBeNull();
  });
});

describe('wallet address management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves the wallet address', () => {
    setWalletAddress('GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F');
    expect(getWalletAddress()).toBe('GA5ZSE6VKPVFLEXMWJQBGHE4FJHKQIFSJMLQ7H4VFQB4UHLEH5IOVK3F');
  });

  it('returns null when no wallet address is stored', () => {
    expect(getWalletAddress()).toBeNull();
  });
});
