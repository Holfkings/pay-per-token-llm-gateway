'use client';

import { Bell, Settings, Wallet, LogOut } from 'lucide-react';
import { useState } from 'react';

export function Navbar() {
  const [connected, setConnected] = useState(false);

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center">
          <span className="text-white font-bold text-sm">x</span>
        </div>
        <span className="font-semibold text-lg">x402 Gateway</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/50 ml-2">
          Testnet
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors relative">
          <Bell className="w-5 h-5 text-gray-400" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />
        </button>

        <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <Settings className="w-5 h-5 text-gray-400" />
        </button>

        {connected ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground font-mono">GA5Z...3FL</span>
            <button className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1">
              <LogOut className="w-4 h-4" /> Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConnected(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
