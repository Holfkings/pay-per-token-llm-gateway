//! x402 Payment Verifier — Soroban Smart Contract
//!
//! Records verified x402 payments on-chain. Uses per-entry instance
//! storage (O(1) writes) instead of a growing Vec to keep gas costs
//! constant regardless of payment history size.
//!
//! Storage layout:
//!   CONFIG            → ContractConfig
//!   PAYMENT_COUNT     → u32
//!   (PAYMENT, idx)    → Payment          (indexed by position)
//!   (TX_INDEX, hash)  → u32              (tx_hash → position lookup)
//!   (USED_TX, hash)   → bool             (replay protection)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

// ── Types ────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub tx_hash: String,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub asset: String,
    pub timestamp: u64,
    pub quote_id: String,
    pub verified: bool,
    /// True once the admin marks this payment as refunded. The hash stays
    /// consumed (replay protection), but the record reflects reality.
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct ContractConfig {
    pub admin: Address,
    pub paused: bool,
}

// ── Storage Keys ─────────────────────────────

const CONFIG_KEY: Symbol = symbol_short!("CONFIG");
const PAYMENT_KEY: Symbol = symbol_short!("PAYMENT");
const TX_INDEX_KEY: Symbol = symbol_short!("TX_IDX");
const USED_TX_KEY: Symbol = symbol_short!("USED_TX");
const PAYMENT_COUNT_KEY: Symbol = symbol_short!("PAY_CNT");

// ── Events ───────────────────────────────────

fn emit_payment_verified(env: &Env, payment: &Payment) {
    let topics = (symbol_short!("pay_verif"), payment.tx_hash.clone());
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
    let topics = (symbol_short!("pay_refun"), tx_hash);
    env.events().publish(topics, reason);
}

// ── Contract ─────────────────────────────────

#[contract]
pub struct PaymentVerifier;

#[contractimpl]
impl PaymentVerifier {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&CONFIG_KEY) {
            panic!("Contract already initialized");
        }
        let config = ContractConfig {
            admin,
            paused: false,
        };
        env.storage().instance().set(&CONFIG_KEY, &config);
        env.storage().instance().set(&PAYMENT_COUNT_KEY, &0u32);
    }

    /// Record a verified payment. O(1) storage — constant gas cost.
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
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if config.paused {
            panic!("Contract is paused");
        }
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Deduplication — O(1) lookup
        let used_key = (USED_TX_KEY, tx_hash.clone());
        if env.storage().instance().has(&used_key) {
            panic!("Payment already recorded (replay protection)");
        }
        env.storage().instance().set(&used_key, &true);

        // Get next index
        let count: u32 = env.storage().instance().get(&PAYMENT_COUNT_KEY).unwrap();
        let idx = count;

        // Store payment at (PAYMENT, idx) — O(1) write
        let payment = Payment {
            tx_hash: tx_hash.clone(),
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            asset: asset.clone(),
            timestamp,
            quote_id: quote_id.clone(),
            verified: true,
            refunded: false,
        };
        let payment_entry = (PAYMENT_KEY, idx);
        env.storage().instance().set(&payment_entry, &payment);

        // Store tx_hash → index mapping — O(1) write
        let tx_entry = (TX_INDEX_KEY, tx_hash);
        env.storage().instance().set(&tx_entry, &idx);

        // Update count — O(1) write
        env.storage().instance().set(&PAYMENT_COUNT_KEY, &(count + 1));

        emit_payment_verified(&env, &payment);
    }

    /// O(1) check if a payment hash has been used.
    pub fn is_payment_used(env: Env, tx_hash: String) -> bool {
        let used_key = (USED_TX_KEY, tx_hash);
        env.storage().instance().has(&used_key)
    }

    /// Get paginated payments. O(limit) reads — constant gas regardless of
    /// total payment count.
    pub fn get_payments(env: Env, offset: u32, limit: u32) -> Vec<Payment> {
        let count: u32 = env.storage().instance().get(&PAYMENT_COUNT_KEY).unwrap();
        let mut result = Vec::new(&env);
        let end = (offset + limit).min(count);

        for i in offset..end {
            let payment_entry = (PAYMENT_KEY, i);
            if let Some(payment) = env.storage().instance().get(&payment_entry) {
                result.push_back(payment);
            }
        }
        result
    }

    /// O(1) lookup by transaction hash.
    pub fn get_payment(env: Env, tx_hash: String) -> Option<Payment> {
        let tx_entry = (TX_INDEX_KEY, tx_hash);
        let idx: u32 = env.storage().instance().get(&tx_entry)?;
        let payment_entry = (PAYMENT_KEY, idx);
        env.storage().instance().get(&payment_entry)
    }

    /// Mark a payment as refunded. Only callable by admin.
    /// The tx hash remains consumed (replay protection), but the stored
    /// record's `refunded` flag is flipped so the on-chain audit trail
    /// reflects the refund.
    pub fn refund_payment(env: Env, tx_hash: String, reason: String) {
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if config.paused {
            panic!("Contract is paused");
        }

        let tx_entry = (TX_INDEX_KEY, tx_hash.clone());
        let idx: u32 = env
            .storage()
            .instance()
            .get(&tx_entry)
            .expect("Payment not found");
        let payment_entry = (PAYMENT_KEY, idx);
        let mut payment: Payment = env.storage().instance().get(&payment_entry).unwrap();

        if payment.refunded {
            panic!("Payment already refunded");
        }
        payment.refunded = true;
        env.storage().instance().set(&payment_entry, &payment);

        emit_payment_refunded(&env, tx_hash, reason);
    }

    /// O(1) total payment count.
    pub fn total_payments(env: Env) -> u32 {
        env.storage().instance().get(&PAYMENT_COUNT_KEY).unwrap_or(0)
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

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

        let contract_id = env.register(PaymentVerifier, ());
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

        assert!(client.is_payment_used(&tx_hash));
        assert_eq!(client.total_payments(), 1);

        let payment = client.get_payment(&tx_hash).unwrap();
        assert_eq!(payment.tx_hash, tx_hash);
        assert_eq!(payment.amount, 100_000_000i128);
        assert!(payment.verified);
    }

    #[test]
    fn test_get_payments_pagination() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        for i in 0..5 {
            let hash = String::from_str(&env, &["tx0", "tx1", "tx2", "tx3", "tx4"][i as usize]);
            client.mock_all_auths().record_payment(
                &hash,
                &payer,
                &payee,
                &((i + 1) as i128 * 100_000_000),
                &String::from_str(&env, "USDC"),
                &1712345678u64,
                &String::from_str(&env, &["q0", "q1", "q2", "q3", "q4"][i as usize]),
            );
        }

        assert_eq!(client.total_payments(), 5);

        let page1 = client.get_payments(&0, &2);
        assert_eq!(page1.len(), 2);

        let page2 = client.get_payments(&2, &3);
        assert_eq!(page2.len(), 3);
    }

    #[test]
    #[should_panic(expected = "Payment already recorded")]
    fn test_replay_protection() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
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

    // ── Authorization & refund tests ─────────────

    #[test]
    fn test_record_payment_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "unauth1");

        // No admin signature → require_auth() must fail.
        let result = client.try_record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );
        assert!(result.is_err());
        assert!(!client.is_payment_used(&tx_hash));
    }

    #[test]
    fn test_refund_payment_updates_state() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "refund1");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );

        let before = client.get_payment(&tx_hash).unwrap();
        assert!(!before.refunded);

        client
            .mock_all_auths()
            .refund_payment(&tx_hash, &String::from_str(&env, "customer refund"));

        let after = client.get_payment(&tx_hash).unwrap();
        assert!(after.refunded);
        // Replay protection must still hold after a refund.
        assert!(client.is_payment_used(&tx_hash));
    }

    #[test]
    fn test_refund_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "refund2");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );

        // Unauthenticated refund must fail and leave the record unchanged.
        let result = client.try_refund_payment(&tx_hash, &String::from_str(&env, "nope"));
        assert!(result.is_err());
        assert!(!client.get_payment(&tx_hash).unwrap().refunded);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_record_payment_rejects_non_positive_amount() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "zeroamt");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &0i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-001"),
        );
    }
}
