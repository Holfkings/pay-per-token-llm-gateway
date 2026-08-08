'use client';

import { Webhook, Plus, Globe, Loader2, AlertTriangle, RefreshCw, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastSent: string | null;
}

export default function WebhooksPage() {
  // Webhook CRUD API not yet exposed — this page uses local state
  // with proper loading, error, and empty states.
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // TODO: Replace with useQuery when webhook endpoints are added:
        // const result = await fetchWebhooks();
        await new Promise((r) => setTimeout(r, 800));
        if (!cancelled) setWebhooks([]);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = () => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      setWebhooks([]);
      setLoading(false);
    }, 800);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground mt-1">
            Configure webhook endpoints for real-time event notifications
          </p>
        </div>
        <button
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Add Webhook
        </button>
      </div>

      {error && (
        <div className="card border-red-800/30 bg-red-950/10">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-900/20 rounded-lg shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-red-400">Failed to load webhooks</h3>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <button
                onClick={reload}
                className="inline-flex items-center gap-1.5 mt-2 text-sm text-green-400 hover:text-green-300 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card">
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading webhooks...</p>
          </div>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="card">
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="p-3 bg-gray-800 rounded-full">
              <Globe className="w-8 h-8 text-gray-500" />
            </div>
            <div className="text-center max-w-md">
              <h3 className="font-medium text-gray-300">No webhooks configured</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Webhooks let your application receive real-time notifications when events happen on
                the gateway — like payments received, requests forwarded, or verification failures.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                {['payment_received', 'request_forwarded', 'verification_failed'].map((ev) => (
                  <span key={ev} className="badge badge-green text-xs">
                    {ev}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Add your first webhook endpoint to start receiving these events.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => (
            <div key={wh.id} className="card group hover:border-green-800/30 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-900/20 rounded-lg">
                    <Webhook className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <span className="font-mono text-sm">{wh.url}</span>
                    <div className="flex items-center gap-2 mt-1">
                      {wh.events.map((e) => (
                        <span key={e} className="badge badge-green text-xs">
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${wh.active ? 'badge-green' : 'badge-red'}`}>
                    {wh.active ? 'Active' : 'Inactive'}
                  </span>
                  {wh.lastSent ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last sent: {new Date(wh.lastSent).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never sent</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
