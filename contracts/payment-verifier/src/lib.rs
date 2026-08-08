//! x402 Payment Verifier — Soroban Smart Contract
//!
//! This contract records verified x402 payments on-chain and emits events
//! that the gateway listens to for off-chain processing.
//!
//! Security considerations:
//! - Only the gateway admin can record payments
//! - Payments are never double-counted (deduplication by payment hash)
//! - Events can be consumed by external indexers

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

// ── Types ────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    /// Transaction hash on Stellar
    pub tx_hash: String,
    /// Payer's Stellar address
    pub payer: Address,
    /// Destination address (provider)
    pub payee: Address,
    /// Amount in stroops (smallest unit)
    pub amount: i128,
    /// Asset code (e.g., "USDC")
    pub asset: String,
    /// Timestamp of the payment
    pub timestamp: u64,
    /// Associated quote ID
    pub quote_id: String,
    /// Whether this payment has been verified
    pub verified: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct ContractConfig {
    /// The admin address authorized to record payments
    pub admin: Address,
    /// Whether the contract is paused
    pub paused: bool,
}

// ── Storage Keys ─────────────────────────────

const CONFIG_KEY: Symbol = symbol_short!("CONFIG");
const PAYMENTS_KEY: Symbol = symbol_short!("PAYMENTS");
const USED_TX_KEY: Symbol = symbol_short!("USED_TX");

// ── Events ───────────────────────────────────

fn emit_payment_verified(env: &Env, payment: &Payment) {
    let topics = (
        symbol_short!("payment_verif"),
        payment.tx_hash.clone(),
    );
    env.events().publish(
        topics,
        (
            payment.payer.clone(),
            payment.payee.clone(),
            payment.amount,
            payment.asset.clone(),
            payment.timestamp,
            payment.quote_id.clone(),
        ),
    );
}

fn emit_payment_refunded(env: &Env, tx_hash: String, reason: String) {
    let topics = (symbol_short!("payment_refun"), tx_hash);
    env.events().publish(topics, reason);
}

// ── Contract ─────────────────────────────────

#[contract]
pub struct PaymentVerifier;

#[contractimpl]
impl PaymentVerifier {
    /// Initialize the contract with an admin address.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&CONFIG_KEY) {
            panic!("Contract already initialized");
        }

        let config = ContractConfig {
            admin,
            paused: false,
        };
        env.storage().instance().set(&CONFIG_KEY, &config);

        // Initialize payment storage (Map style)
        let payments: Vec<Payment> = Vec::new(&env);
        env.storage().instance().set(&PAYMENTS_KEY, &payments);
    }

    /// Record a verified payment. Only callable by admin.
    pub fn record_payment(
        env: Env,
        tx_hash: String,
        payer: Address,
        payee: Address,
        amount: i128,
        asset: String,
        timestamp: u64,
        quote_id: String,
    ) {
        // Auth check
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if config.paused {
            panic!("Contract is paused");
        }

        // Deduplication check
        let used_key = (USED_TX_KEY, tx_hash.clone());
        if env.storage().instance().has(&used_key) {
            panic!("Payment already recorded (replay protection)");
        }
        env.storage().instance().set(&used_key, &true);

        // Record payment
        let payment = Payment {
            tx_hash: tx_hash.clone(),
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            asset: asset.clone(),
            timestamp,
            quote_id: quote_id.clone(),
            verified: true,
        };

        let mut payments: Vec<Payment> = env.storage().instance().get(&PAYMENTS_KEY).unwrap();
        payments.push_back(payment.clone());
        env.storage().instance().set(&PAYMENTS_KEY, &payments);

        // Emit event
        emit_payment_verified(&env, &payment);
    }

    /// Check if a transaction hash has been used.
    pub fn is_payment_used(env: Env, tx_hash: String) -> bool {
        let used_key = (USED_TX_KEY, tx_hash);
        env.storage().instance().has(&used_key)
    }

    /// Get all recorded payments (paginated).
    pub fn get_payments(env: Env, offset: u32, limit: u32) -> Vec<Payment> {
        let payments: Vec<Payment> = env.storage().instance().get(&PAYMENTS_KEY).unwrap();
        let mut result = Vec::new(&env);
        let start = offset as u32;
        let end = (offset + limit).min(payments.len() as u32);

        for i in start..end {
            if let Some(payment) = payments.get(i) {
                result.push_back(payment);
            }
        }

        result
    }

    /// Get a specific payment by transaction hash.
    pub fn get_payment(env: Env, tx_hash: String) -> Option<Payment> {
        let payments: Vec<Payment> = env.storage().instance().get(&PAYMENTS_KEY).unwrap();
        for payment in payments.iter() {
            if payment.tx_hash == tx_hash {
                return Some(payment);
            }
        }
        None
    }

    /// Mark a payment as refunded. Only callable by admin.
    pub fn refund_payment(env: Env, tx_hash: String, reason: String) {
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();

        emit_payment_refunded(&env, tx_hash, reason);
    }

    /// Get total payments recorded.
    pub fn total_payments(env: Env) -> u32 {
        let payments: Vec<Payment> = env.storage().instance().get(&PAYMENTS_KEY).unwrap();
        payments.len()
    }

    /// Transfer admin rights.
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    /// Pause or unpause the contract.
    pub fn set_paused(env: Env, paused: bool) {
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.paused = paused;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }
}

// ── Tests ────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_record_payment() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register_contract(None, PaymentVerifier);
        let client = PaymentVerifierClient::new(&env, &contract_id);

        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let tx_hash = String::from_str(&env, "abc123");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128, // 100 USDC (7 decimals)
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );

        assert!(client.is_payment_used(&tx_hash));
        assert_eq!(client.total_payments(), 1);

        let payment = client.get_payment(&tx_hash).unwrap();
        assert_eq!(payment.tx_hash, tx_hash);
        assert_eq!(payment.amount, 100_000_000i128);
        assert!(payment.verified);
    }

    #[test]
    #[should_panic(expected = "Payment already recorded")]
    fn test_replay_protection() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register_contract(None, PaymentVerifier);
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "abc123");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );

        // This should panic
        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-002"),
        );
    }
}
