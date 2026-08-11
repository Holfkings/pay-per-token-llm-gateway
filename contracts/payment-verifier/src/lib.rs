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
//!
//! All entries live in instance storage (a single ContractInstance entry),
//! so one `extend_ttl` call per state-mutating invocation keeps the instance
//! AND the contract code alive — without it the network default TTL (~4096
//! ledgers) would archive the audit trail within hours. Read-only functions
//! deliberately do NOT extend the TTL (reads are free and permissionless, so
//! letting anyone bump the TTL by spamming reads would be an abuse vector).

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

// ── Storage TTL ─────────────────────────────
//
// Soroban instance storage and the contract code are archived once their
// ledger TTL expires unless explicitly extended (the network default is only
// ~4096 ledgers — hours on mainnet). Only MUTATING functions (init,
// record_payment, refund_payment, set_admin, set_paused) bump the instance +
// code TTL back to LEDGERS_TO_LIVE; the call is a free no-op while the
// remaining TTL is above LEDGER_THRESHOLD. Read-only functions never extend
// the TTL — an unbounded read flood must not be able to keep a contract alive
// forever at the caller's expense.
const LEDGER_THRESHOLD: u32 = 500_000;
const LEDGERS_TO_LIVE: u32 = 1_000_000;

/// Maximum number of entries a single paginated read may return.
const MAX_PAGE_SIZE: u32 = 100;

/// Bump the TTL of the contract instance and code so the contract and all of
/// its stored data are never archived while the contract is in use.
/// Call from mutating functions only — never from read-only paths.
fn extend_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGERS_TO_LIVE);
}

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
        extend_ttl(&env);
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
        extend_ttl(&env);
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

    /// O(1) check if a payment hash has been used. Read-only — does not
    /// extend the storage TTL.
    pub fn is_payment_used(env: Env, tx_hash: String) -> bool {
        let used_key = (USED_TX_KEY, tx_hash);
        env.storage().instance().has(&used_key)
    }

    /// Get paginated payments. O(limit) reads — constant gas regardless of
    /// total payment count. Read-only — does not extend the storage TTL.
    ///
    /// The caller-supplied `limit` is clamped to MAX_PAGE_SIZE so a single
    /// invocation can never trigger more than 100 storage reads, and
    /// `saturating_add` prevents u32 overflow in the end-index computation.
    pub fn get_payments(env: Env, offset: u32, limit: u32) -> Vec<Payment> {
        let count: u32 = env.storage().instance().get(&PAYMENT_COUNT_KEY).unwrap();
        let mut result = Vec::new(&env);
        let end = offset.saturating_add(limit.min(MAX_PAGE_SIZE)).min(count);

        for i in offset..end {
            let payment_entry = (PAYMENT_KEY, i);
            if let Some(payment) = env.storage().instance().get(&payment_entry) {
                result.push_back(payment);
            }
        }
        result
    }

    /// O(1) lookup by transaction hash. Read-only — does not extend the
    /// storage TTL.
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
        extend_ttl(&env);
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

    /// O(1) total payment count. Read-only — does not extend the storage TTL.
    pub fn total_payments(env: Env) -> u32 {
        env.storage().instance().get(&PAYMENT_COUNT_KEY).unwrap_or(0)
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        extend_ttl(&env);
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    pub fn set_paused(env: Env, paused: bool) {
        extend_ttl(&env);
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
    use soroban_sdk::testutils::storage::Instance as _;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;

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
    fn test_get_payments_limit_is_clamped() {
        // A caller must not be able to request an unbounded page: the limit is
        // clamped to MAX_PAGE_SIZE, so a single read can never issue more than
        // 100 storage reads.
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        for i in 0..150u32 {
            let hash = String::from_str(&env, &["tx-clamp-000", "tx-clamp-001", "tx-clamp-002"][i as usize % 3]);
            client.mock_all_auths().record_payment(
                &hash,
                &payer,
                &payee,
                &((i + 1) as i128 * 100_000_000),
                &String::from_str(&env, "USDC"),
                &1712345678u64,
                &String::from_str(&env, "q-clamp"),
            );
        }

        // Request 150 entries — only MAX_PAGE_SIZE are returned.
        let page = client.get_payments(&0, &150);
        assert_eq!(page.len(), MAX_PAGE_SIZE);

        // A u32::MAX offset must not panic (saturating arithmetic) and simply
        // returns nothing.
        let overflow = client.get_payments(&u32::MAX, &u32::MAX);
        assert_eq!(overflow.len(), 0);
    }

    #[test]
    fn test_reads_do_not_extend_ttl() {
        // Read-only functions must not bump the instance TTL: an unbounded
        // read flood from any caller would otherwise keep the contract alive
        // forever. init + record_payment already extended it, so a subsequent
        // read must leave it exactly unchanged.
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "read-ttl-1");
        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "q-read-ttl"),
        );

        let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

        // Read-only calls: lookups + an aggressive page request.
        client.is_payment_used(&tx_hash);
        client.get_payment(&tx_hash);
        client.get_payments(&0, &u32::MAX);
        client.total_payments();

        let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert_eq!(
            ttl_after, ttl_before,
            "a read-only call must not extend the instance TTL"
        );
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

    // ── Storage TTL tests ────────────────────────

    #[test]
    fn test_ttl_extended_after_init() {
        // The network default persistent TTL is only ~4096 ledgers. `init`
        // must explicitly extend the instance + code TTL far past that, or
        // the contract would be archived within hours.
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        // Storage access from tests must run in the contract's context.
        let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(
            ttl >= LEDGERS_TO_LIVE,
            "contract instance TTL was not extended past the network default"
        );
    }

    #[test]
    fn test_payment_record_survives_default_ttl() {
        // Without explicit TTL extension a payment record would be archived
        // after ~4096 ledgers. Jump well past that and verify the record is
        // still readable (a read of an archived entry errors in tests).
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(PaymentVerifier, ());
        let client = PaymentVerifierClient::new(&env, &contract_id);
        client.init(&admin);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let tx_hash = String::from_str(&env, "ttl-tx-1");

        client.mock_all_auths().record_payment(
            &tx_hash,
            &payer,
            &payee,
            &100_000_000i128,
            &String::from_str(&env, "USDC"),
            &1712345678u64,
            &String::from_str(&env, "quote-ttl"),
        );

        // The write path itself must extend the instance TTL — not just init.
        let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(
            ttl >= LEDGERS_TO_LIVE,
            "record_payment did not extend the instance TTL"
        );

        // Jump 100k ledgers (>> the ~4096 default TTL, < LEDGERS_TO_LIVE).
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 100_000);

        assert!(client.is_payment_used(&tx_hash));
        let payment = client.get_payment(&tx_hash).unwrap();
        assert_eq!(payment.amount, 100_000_000i128);
        assert!(payment.verified);
    }
}
