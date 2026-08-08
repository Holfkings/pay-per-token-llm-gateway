/**
 * Gateway API client.
 * Calls the NestJS gateway directly (CORS is configured for dashboard origin).
 */
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const BASE = `${GATEWAY_URL}/api/v1`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gateway error ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Payments ────────────────────────────────

export interface PaymentResponse {
  id: string;
  quoteId: string;
  txHash: string | null;
  payerAddress: string | null;
  amount: string;
  asset: string;
  status: string;
  verifiedAt: string | null;
  routeId: string;
  providerId: string;
  createdAt: string;
}

export interface PaginatedPayments {
  data: PaymentResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function fetchPayments(params?: {
  providerId?: string;
  status?: string;
  payerAddress?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedPayments> {
  const qs = new URLSearchParams();
  if (params?.providerId) qs.set('providerId', params.providerId);
  if (params?.status) qs.set('status', params.status);
  if (params?.payerAddress) qs.set('payerAddress', params.payerAddress);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return request<PaginatedPayments>(`/payments${query ? `?${query}` : ''}`);
}

// ── Routes ───────────────────────────────────

export interface RouteResponse {
  id: string;
  providerId: string;
  path: string;
  upstreamUrl: string;
  model: string;
  pricingModel: 'flat' | 'per_token';
  flatPrice?: string;
  perTokenPrice?: string;
  acceptedAssets: string[];
  rateLimit: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function fetchRoutes(providerId?: string): Promise<RouteResponse[]> {
  return request<RouteResponse[]>(`/routes${providerId ? `?providerId=${providerId}` : ''}`);
}

export function createRoute(data: {
  providerId: string;
  path: string;
  upstreamUrl: string;
  model: string;
  pricingModel: 'flat' | 'per_token';
  flatPrice?: string;
  perTokenPrice?: string;
  acceptedAssets?: string[];
  rateLimit?: number;
}): Promise<RouteResponse> {
  return request<RouteResponse>('/routes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateRoute(id: string, data: Partial<RouteResponse>): Promise<RouteResponse> {
  return request<RouteResponse>(`/routes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteRoute(id: string): Promise<void> {
  return request<void>(`/routes/${id}`, { method: 'DELETE' });
}

// ── Analytics ────────────────────────────────

export interface AnalyticsSummary {
  totalRequests: number;
  paidRequests: number;
  unpaidRequests: number;
  totalRevenue: string;
  revenueAsset: string;
  averageResponseTime: number;
  successRate: number;
  topCallers: Array<{ address: string; totalSpent: string; requestCount: number }>;
  topRoutes: Array<{ path: string; requestCount: number; revenue: string }>;
}

export interface TimeSeriesPoint {
  timestamp: string;
  paidRequests: number;
  unpaidRequests: number;
  revenue: string;
  failedVerifications: number;
}

export function fetchAnalyticsSummary(providerId?: string): Promise<AnalyticsSummary> {
  return request<AnalyticsSummary>(
    `/analytics/summary${providerId ? `?providerId=${providerId}` : ''}`,
  );
}

export function fetchTimeSeries(
  providerId: string,
  intervalMinutes?: number,
  durationHours?: number,
): Promise<TimeSeriesPoint[]> {
  const qs = new URLSearchParams({ providerId });
  if (intervalMinutes) qs.set('intervalMinutes', String(intervalMinutes));
  if (durationHours) qs.set('durationHours', String(durationHours));
  return request<TimeSeriesPoint[]>(`/analytics/timeseries?${qs.toString()}`);
}

// ── Admin / Audit ────────────────────────────

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  actor?: string;
  details?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function fetchAuditLogs(params?: {
  page?: number;
  limit?: number;
  action?: string;
  entity?: string;
}): Promise<PaginatedAuditLogs> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.action) qs.set('action', params.action);
  if (params?.entity) qs.set('entity', params.entity);
  const query = qs.toString();
  return request<PaginatedAuditLogs>(`/admin/audit${query ? `?${query}` : ''}`);
}

// ── Providers ────────────────────────────────

export interface ProviderResponse {
  id: string;
  name: string;
  walletAddress: string;
  payoutWalletAddress?: string;
  active: boolean;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export function fetchProviders(): Promise<ProviderResponse[]> {
  return request<ProviderResponse[]>('/providers');
}

export function createProvider(data: {
  name: string;
  walletAddress: string;
  payoutWalletAddress?: string;
}): Promise<ProviderResponse> {
  return request<ProviderResponse>('/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProvider(
  id: string,
  data: Partial<ProviderResponse>,
): Promise<ProviderResponse> {
  return request<ProviderResponse>(`/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
