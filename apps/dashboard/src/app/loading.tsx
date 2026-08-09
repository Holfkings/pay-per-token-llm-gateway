import { Loader2 } from 'lucide-react';

export default function LoadingPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/icon.svg"
          alt="x402 Logo"
          className="w-16 h-16 rounded-xl shadow-lg shadow-green-500/20 animate-pulse"
        />
        <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
