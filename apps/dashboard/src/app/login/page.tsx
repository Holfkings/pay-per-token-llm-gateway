'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, ArrowRight, Shield, Zap } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async (wallet: string) => {
    setConnecting(true);
    // In production, this would trigger Freighter/xBull/Albedo connection
    // and challenge-response auth with the gateway
    await new Promise((r) => setTimeout(r, 1500));
    setConnecting(false);
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-green-500/20">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">x402 Gateway</h1>
          <p className="text-muted-foreground mt-2">
            Connect your Stellar wallet to manage your LLM endpoints
          </p>
        </div>

        <div className="space-y-3">
          {[
            { name: 'Freighter', icon: Wallet, color: 'from-green-500 to-emerald-600' },
            { name: 'xBull', icon: Shield, color: 'from-blue-500 to-purple-600' },
            { name: 'Albedo', icon: Wallet, color: 'from-yellow-500 to-orange-600' },
          ].map((wallet) => (
            <button
              key={wallet.name}
              onClick={() => handleConnect(wallet.name)}
              disabled={connecting}
              className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-green-800/50 transition-all disabled:opacity-50 group"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${wallet.color} flex items-center justify-center`}>
                  <wallet.icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <span className="font-medium">{wallet.name}</span>
                  <p className="text-xs text-muted-foreground">Stellar browser wallet</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-green-400 transition-colors" />
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Don't have a wallet?{' '}
          <a href="https://freighter.app" target="_blank" className="text-green-400 hover:underline">
            Install Freighter
          </a>
        </p>
      </div>
    </div>
  );
}
