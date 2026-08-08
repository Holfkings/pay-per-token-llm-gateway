import { Loader2 } from 'lucide-react';

export default function LoadingPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
