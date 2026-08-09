/**
 * Soroban contract client for the payment-verifier contract.
 *
 * Uses raw JSON-RPC calls to the Soroban RPC to avoid SDK type complexity.
 * All contract interactions are best-effort — failures are logged but never
 * block the primary Horizon-based payment verification flow.
 */

/** JSON-RPC 2.0 response wrapper */
interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/** Ledger key for contract data queries */
interface ContractDataKey {
  type: 'contractData';
  contractId: string;
  key: {
    type: 'vec';
    value: Array<{ type: 'symbol' | 'string'; value: string }>;
  };
  durability: 'persistent' | 'temporary';
}

/** Response from getLedgerEntries */
interface GetLedgerEntriesResult {
  entries: Array<{
    key: ContractDataKey;
    xdr: string;
    lastModifiedLedgerSeq: number;
  }>;
}

async function sorobanRpcCall<T = unknown>(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as RpcResponse<T>;
  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }
  return json.result as T;
}

/**
 * Check if a transaction hash has already been recorded on-chain.
 * Uses the `getLedgerEntries` RPC to check for the payment record.
 *
 * Returns true if the payment exists on-chain, false otherwise.
 */
export async function isPaymentUsedOnChain(
  contractId: string,
  txHash: string,
  rpcUrl: string,
): Promise<boolean> {
  try {
    const key: ContractDataKey = {
      type: 'contractData',
      contractId,
      key: {
        type: 'vec',
        value: [
          { type: 'symbol', value: 'USED_TX' },
          { type: 'string', value: txHash },
        ],
      },
      durability: 'persistent',
    };

    const result = await sorobanRpcCall<GetLedgerEntriesResult>(
      rpcUrl,
      'getLedgerEntries',
      { keys: [key] },
    );

    return !!(result?.entries && result.entries.length > 0);
  } catch {
    // If the contract is unreachable, assume not used (fall back to Redis)
    return false;
  }
}
