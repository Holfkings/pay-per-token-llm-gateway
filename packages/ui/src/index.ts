// ──────────────────────────────────────────────
// @x402/ui — Shared UI utilities for dashboard
// ──────────────────────────────────────────────

/**
 * Format a Stellar address for display (truncated).
 */
export function formatAddress(address: string, length = 8): string {
  if (!address) return '';
  if (address.length <= length * 2 + 3) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

/**
 * Format an amount for display with the asset.
 */
export function formatAmountDisplay(amount: string, asset: string, decimals = 7): string {
  try {
    const num = Number(amount) / Math.pow(10, decimals);
    const formatted = num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
    return `${formatted} ${asset}`;
  } catch {
    return `${amount} ${asset}`;
  }
}

/**
 * Format a date for display.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format relative time (e.g., "2 hours ago").
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

/**
 * Get a color for a payment status badge.
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'refunded': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'expired': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    default: return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Truncate a transaction hash for display.
 */
export function formatTxHash(hash: string): string {
  if (!hash || hash.length < 16) return hash || '';
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}
