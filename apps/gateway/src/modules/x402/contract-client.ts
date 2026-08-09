/**
 * Soroban contract client for the payment-verifier contract.
 *
 * Uses raw JSON-RPC calls to the Soroban RPC to avoid SDK type complexity.
 * All contract interactions are best-effort — failures are logged but never
 * block the primary Horizon-based payment verification flow.
 */

interface RpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: any;
}

async function sorobanRpcCall(rpcUrl: string, method: string, params: any): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as RpcResponse;
  if (json.error) {
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
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
    // Query the contract's storage for the USED_TX key
    // The key format in the contract is (Symbol("USED_TX"), txHash)
    const result = await sorobanRpcCall(rpcUrl, 'getLedgerEntries', {
      keys: [
        // LedgerKey for contract data — we check if the USED_TX + txHash entry exists
        {
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
        },
      ],
    });

    // If entries exist, the payment has been recorded
    return !!(result?.entries && result.entries.length > 0);
  } catch {
    // If the contract is unreachable, assume not used (fall back to Redis)
    return false;
  }
}
