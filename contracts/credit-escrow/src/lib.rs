//! x402 Credit Escrow — Soroban Smart Contract (v2)
//!
//! Holds prepaid credit balances for callers. Uses per-entry instance
//! storage for O(1) writes on usage events to keep gas costs constant.
//!
//! Storage layout:
//!   CONFIG                          → ContractConfig
//!   (BALANCES, user)                → i128
//!   (USAGE_COUNT, user)             → u32
//!   (USAGE, user, idx)              → UsageEvent
//!   (CHARGED, user, quote_id)       → bool   (charge idempotency)
//!   (REFUNDED, user, quote_id)      → bool   (refund idempotency)
//!   REVENUE                         → i128   (accumulated admin revenue)
//!
//! All entries live in instance storage (a single ContractInstance entry),
//! so one `extend_ttl` call per state-mutating invocation keeps the instance
//! AND the contract code alive — without it the network default TTL (~4096
//! ledgers) would archive balances and usage history within hours. Read-only
//! functions deliberately do NOT extend the TTL (reads are free and
//! permissionless, so letting anyone bump the TTL by spamming reads would be
//! an abuse vector).

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol, Vec,
};

// ── Types ────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ContractConfig {
    pub admin: Address,
    pub asset: Address,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct UsageEvent {
    pub user: Address,
    pub amount: i128,
    pub quote_id: String,
    pub timestamp: u64,
}

// ── Storage Keys ─────────────────────────────

const CONFIG_KEY: Symbol = symbol_short!("CONFIG");
const BALANCES_KEY: Symbol = symbol_short!("BALANCES");
const USAGE_KEY: Symbol = symbol_short!("USAGE");
const USAGE_COUNT_KEY: Symbol = symbol_short!("USG_CNT");
const CHARGED_KEY: Symbol = symbol_short!("CHARGED");
const REFUNDED_KEY: Symbol = symbol_short!("REFUNDED");
const REVENUE_KEY: Symbol = symbol_short!("REVENUE");

// ── Storage TTL ─────────────────────────────
//
// Soroban instance storage and the contract code are archived once their
// ledger TTL expires unless explicitly extended (the network default is only
// ~4096 ledgers — hours on mainnet). Only MUTATING functions (deposit,
// withdraw, charge, refund, withdraw_revenue, set_admin, set_paused, init)
// bump the instance + code TTL back to LEDGERS_TO_LIVE; the call is a free
// no-op while the remaining TTL is above LEDGER_THRESHOLD. Read-only
// functions never extend the TTL — an unbounded read flood must not be able
// to keep a contract alive forever at the caller's expense.
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

fn emit_deposit(env: &Env, user: &Address, amount: i128) {
    let topics = (symbol_short!("deposit"), user.clone());
    env.events().publish(topics, amount);
}

fn emit_withdrawal(env: &Env, user: &Address, amount: i128) {
    let topics = (symbol_short!("withdraw"), user.clone());
    env.events().publish(topics, amount);
}

fn emit_usage(env: &Env, user: &Address, amount: i128, quote_id: String) {
    let topics = (symbol_short!("usage"), user.clone());
    env.events().publish(topics, (amount, quote_id));
}

fn emit_refund(env: &Env, user: &Address, amount: i128, quote_id: String) {
    let topics = (symbol_short!("refund"), user.clone());
    env.events().publish(topics, (amount, quote_id));
}

fn emit_revenue_withdrawn(env: &Env, destination: &Address, amount: i128) {
    let topics = (symbol_short!("rev_with"), destination.clone());
    env.events().publish(topics, amount);
}

// ── Contract ─────────────────────────────────

#[contract]
pub struct CreditEscrow;

#[contractimpl]
impl CreditEscrow {
    pub fn init(env: Env, admin: Address, asset: Address) {
        extend_ttl(&env);
        if env.storage().instance().has(&CONFIG_KEY) {
            panic!("Contract already initialized");
        }
        let config = ContractConfig {
            admin,
            asset,
            paused: false,
        };
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    /// Deposit tokens into escrow. O(1) storage writes.
    pub fn deposit(env: Env, user: Address, amount: i128) {
        extend_ttl(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        if config.paused {
            panic!("Contract is paused");
        }

        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        env.storage().instance().set(&balance_key, &(current + amount));

        emit_deposit(&env, &user, amount);
    }

    /// Withdraw tokens from escrow. O(1) storage writes.
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        extend_ttl(&env);
        user.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        if config.paused {
            panic!("Contract is paused");
        }

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);

        if current < amount {
            panic!("Insufficient balance");
        }

        env.storage().instance().set(&balance_key, &(current - amount));

        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        emit_withdrawal(&env, &user, amount);
    }

    /// Deduct credits for a usage event. O(1) storage writes.
    ///
    /// Idempotent per (user, quote_id): a quote may only be charged once, so a
    /// retried settlement call can never double-deduct a balance.
    pub fn charge(env: Env, user: Address, amount: i128, quote_id: String) {
        extend_ttl(&env);
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if config.paused {
            panic!("Contract is paused");
        }

        // Idempotency guard — O(1) lookup.
        let charged_key = (CHARGED_KEY, user.clone(), quote_id.clone());
        if env.storage().instance().has(&charged_key) {
            panic!("Quote already charged");
        }
        env.storage().instance().set(&charged_key, &true);

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);

        if current < amount {
            panic!("Insufficient prepaid balance");
        }

        env.storage().instance().set(&balance_key, &(current - amount));

        // Accumulate revenue so the admin can withdraw it later.
        // `charge` deducts the user's claim on escrowed tokens but never
        // moves tokens — the contract's token balance stays the same while
        // the sum of user balances shrinks. The difference is tracked here.
        let revenue: i128 = env.storage().instance().get(&REVENUE_KEY).unwrap_or(0);
        env.storage().instance().set(&REVENUE_KEY, &(revenue + amount));

        // Record usage event at next index — O(1) write
        let count_key = (USAGE_COUNT_KEY, user.clone());
        let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0);

        let usage_event = UsageEvent {
            user: user.clone(),
            amount,
            quote_id: quote_id.clone(),
            timestamp: env.ledger().timestamp(),
        };

        let usage_entry = (USAGE_KEY, user.clone(), count);
        env.storage().instance().set(&usage_entry, &usage_event);
        env.storage().instance().set(&count_key, &(count + 1));

        emit_usage(&env, &user, amount, quote_id);
    }

    /// Refund a surplus back to the user. Admin-only, O(1) writes.
    ///
    /// Transfers `amount` of the escrow asset from the contract back to
    /// `user` and records the refund. Idempotent per (user, quote_id): a quote
    /// may only be refunded once.
    pub fn refund(env: Env, user: Address, amount: i128, quote_id: String) {
        extend_ttl(&env);
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if config.paused {
            panic!("Contract is paused");
        }

        // Idempotency guard — O(1) lookup.
        let refunded_key = (REFUNDED_KEY, user.clone(), quote_id.clone());
        if env.storage().instance().has(&refunded_key) {
            panic!("Quote already refunded");
        }
        env.storage().instance().set(&refunded_key, &true);

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        if current < amount {
            panic!("Insufficient prepaid balance");
        }
        env.storage().instance().set(&balance_key, &(current - amount));

        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        emit_refund(&env, &user, amount, quote_id);
    }

    /// Withdraw accumulated revenue to a destination address. Admin-only, O(1).
    ///
    /// Each `charge` call increases the internal revenue counter by the
    /// charged amount. The actual tokens remain in the contract until the
    /// admin withdraws them here — the revenue counter guarantees the admin
    /// can only withdraw what callers have actually paid.
    pub fn withdraw_revenue(env: Env, destination: Address, amount: i128) {
        extend_ttl(&env);
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if config.paused {
            panic!("Contract is paused");
        }

        let revenue: i128 = env.storage().instance().get(&REVENUE_KEY).unwrap_or(0);
        if revenue < amount {
            panic!("Insufficient accumulated revenue");
        }
        env.storage().instance().set(&REVENUE_KEY, &(revenue - amount));

        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&env.current_contract_address(), &destination, &amount);

        emit_revenue_withdrawn(&env, &destination, amount);
    }

    /// O(1) revenue lookup. Returns the total accumulated revenue not yet
    /// withdrawn by the admin. Read-only — does not extend the storage TTL.
    pub fn get_revenue(env: Env) -> i128 {
        env.storage().instance().get(&REVENUE_KEY).unwrap_or(0)
    }

    /// O(1) balance lookup. Read-only — does not extend the storage TTL.
    pub fn balance(env: Env, user: Address) -> i128 {
        let balance_key = (BALANCES_KEY, user);
        env.storage().instance().get(&balance_key).unwrap_or(0)
    }

    /// Transfer admin rights. Only callable by the current admin.
    pub fn set_admin(env: Env, new_admin: Address) {
        extend_ttl(&env);
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    /// Pause or resume deposits/withdrawals/charges. Only callable by admin.
    pub fn set_paused(env: Env, paused: bool) {
        extend_ttl(&env);
        let mut config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();
        config.paused = paused;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    /// Get paginated usage history. O(limit) reads, bounded by MAX_PAGE_SIZE.
    /// Read-only — does not extend the storage TTL.
    ///
    /// The caller-supplied `limit` is clamped to MAX_PAGE_SIZE so a single
    /// invocation can never trigger more than 100 storage reads, and
    /// `saturating_add` prevents u32 overflow in the end-index computation.
    pub fn get_usage(env: Env, user: Address, offset: u32, limit: u32) -> Vec<UsageEvent> {
        let count_key = (USAGE_COUNT_KEY, user.clone());
        let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0);

        let mut result = Vec::new(&env);
        let end = offset.saturating_add(limit.min(MAX_PAGE_SIZE)).min(count);

        for i in offset..end {
            let usage_entry = (USAGE_KEY, user.clone(), i);
            if let Some(event) = env.storage().instance().get(&usage_entry) {
                result.push_back(event);
            }
        }
        result
    }
}

// ── Tests ────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::storage::Instance as _;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::token::StellarAssetClient;

    fn setup(env: &Env) -> (Address, Address, Address, CreditEscrowClient) {
        let admin = Address::generate(env);
        let user = Address::generate(env);

        let token_admin = Address::generate(env);
        let asset = env.register_stellar_asset_contract(token_admin);

        let contract_id = env.register(CreditEscrow, ());
        let client = CreditEscrowClient::new(env, &contract_id);
        client.init(&admin, &asset);

        (admin, user, asset, client)
    }

    #[test]
    fn test_initial_balance_is_zero() {
        let env = Env::default();
        let (_, user, _asset, client) = setup(&env);
        assert_eq!(client.balance(&user), 0);
    }

    #[test]
    fn test_deposit_increases_balance() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user, &500_000_000i128);
        assert_eq!(client.balance(&user), 500_000_000i128);
    }

    #[test]
    fn test_multiple_deposits_accumulate() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user, &100_000_000i128);
        client.mock_all_auths().deposit(&user, &200_000_000i128);
        client.mock_all_auths().deposit(&user, &50_000_000i128);
        assert_eq!(client.balance(&user), 350_000_000i128);
    }

    #[test]
    fn test_withdraw_reduces_balance() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user, &500_000_000i128);
        client.mock_all_auths().withdraw(&user, &200_000_000i128);
        assert_eq!(client.balance(&user), 300_000_000i128);
    }

    #[test]
    #[should_panic(expected = "Insufficient balance")]
    fn test_withdraw_exceeding_balance_panics() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &500_000_000i128);

        client.mock_all_auths().deposit(&user, &100_000_000i128);
        client.mock_all_auths().withdraw(&user, &200_000_000i128);
    }

    #[test]
    fn test_charge_deducts_balance() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let quote_id = String::from_str(&env, "quote-001");
        client.mock_all_auths().charge(&user, &100_000_000i128, &quote_id);
        assert_eq!(client.balance(&user), 400_000_000i128);
    }

    #[test]
    #[should_panic(expected = "Insufficient prepaid balance")]
    fn test_charge_exceeding_balance_panics() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &500_000_000i128);

        client.mock_all_auths().deposit(&user, &100_000_000i128);

        let quote_id = String::from_str(&env, "quote-002");
        client.mock_all_auths().charge(&user, &500_000_000i128, &quote_id);
    }

    #[test]
    fn test_usage_history_recorded() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &2_000_000_000i128);

        client.mock_all_auths().deposit(&user, &1_000_000_000i128);

        let q1 = String::from_str(&env, "quote-001");
        let q2 = String::from_str(&env, "quote-002");

        client.mock_all_auths().charge(&user, &100_000_000i128, &q1);
        client.mock_all_auths().charge(&user, &200_000_000i128, &q2);

        let usage = client.get_usage(&user, &0, &10);
        assert_eq!(usage.len(), 2);

        let first = usage.get(0).unwrap();
        assert_eq!(first.amount, 100_000_000i128);
        assert_eq!(first.quote_id, q1);
    }

    #[test]
    fn test_usage_pagination() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &2_000_000_000i128);

        client.mock_all_auths().deposit(&user, &1_000_000_000i128);

        for i in 0..5 {
            let quote_str = ["quote-000", "quote-001", "quote-002", "quote-003", "quote-004"][i as usize];
            let quote = String::from_str(&env, quote_str);
            client.mock_all_auths().charge(&user, &(10_000_000 * (i + 1) as i128), &quote);
        }

        let page1 = client.get_usage(&user, &0, &2);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().amount, 10_000_000);

        let page2 = client.get_usage(&user, &2, &2);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().amount, 30_000_000);
    }

    #[test]
    fn test_get_usage_limit_is_clamped() {
        // A caller must not be able to request an unbounded page: the limit is
        // clamped to MAX_PAGE_SIZE, so a single read can never issue more than
        // 100 storage reads.
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &10_000_000_000i128);
        client.mock_all_auths().deposit(&user, &5_000_000_000i128);

        for i in 0..150u32 {
            let quote = String::from_str(&env, &["q-clamp-000", "q-clamp-001", "q-clamp-002"][i as usize % 3]);
            client.mock_all_auths().charge(&user, &((i + 1) as i128 * 1_000_000), &quote);
        }

        // Request 150 entries — only MAX_PAGE_SIZE are returned.
        let page = client.get_usage(&user, &0, &150);
        assert_eq!(page.len(), MAX_PAGE_SIZE);

        // A u32::MAX offset must not panic (saturating arithmetic) and simply
        // returns nothing.
        let overflow = client.get_usage(&user, &u32::MAX, &u32::MAX);
        assert_eq!(overflow.len(), 0);
    }

    #[test]
    fn test_reads_do_not_extend_ttl() {
        // Read-only functions must not bump the instance TTL: an unbounded
        // read flood from any caller would otherwise keep the contract alive
        // forever. init + deposit already extended it, so a subsequent read
        // must leave it exactly unchanged.
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);

        let contract_id = env.register(CreditEscrow, ());
        let client2 = CreditEscrowClient::new(&env, &contract_id);
        client2.init(&admin, &asset);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client2.mock_all_auths().deposit(&user, &500_000_000i128);

        let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

        // Read-only calls: balance + get_usage with an aggressive page request.
        client2.balance(&user);
        client2.get_usage(&user, &0, &u32::MAX);
        client2.get_revenue();

        let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert_eq!(
            ttl_after, ttl_before,
            "a read-only call must not extend the instance TTL"
        );
    }

    #[test]
    fn test_independent_user_balances() {
        let env = Env::default();
        let (_admin, user1, asset, client) = setup(&env);
        let user2 = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user1, &1_000_000_000i128);
        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user2, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user1, &300_000_000i128);
        client.mock_all_auths().deposit(&user2, &700_000_000i128);

        assert_eq!(client.balance(&user1), 300_000_000i128);
        assert_eq!(client.balance(&user2), 700_000_000i128);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_init_panics() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract(token_admin);

        let contract_id = env.register(CreditEscrow, ());
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);
        client.init(&admin, &asset);
    }

    // ── Authorization tests (real require_auth, no mock_all_auths) ──

    #[test]
    fn test_deposit_requires_user_auth() {
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        // No auth payload provided → require_auth() for `user` must fail.
        let result = client.try_deposit(&user, &500_000_000i128);
        assert!(result.is_err());
        assert_eq!(client.balance(&user), 0);
    }

    #[test]
    fn test_charge_requires_admin_auth() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let quote_id = String::from_str(&env, "quote-auth");
        // Caller (empty auth) is not the admin → charge must fail.
        let result = client.try_charge(&user, &100_000_000i128, &quote_id);
        assert!(result.is_err());
        assert_eq!(client.balance(&user), 500_000_000i128);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_negative_deposit_rejected() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);

        client.mock_all_auths().deposit(&user, &-100i128);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_negative_charge_rejected() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        let quote_id = String::from_str(&env, "quote-neg");
        client.mock_all_auths().charge(&user, &-100i128, &quote_id);
    }

    // ── Settlement tests (charge idempotency + refund) ──

    #[test]
    #[should_panic(expected = "Quote already charged")]
    fn test_charge_is_idempotent_per_quote() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let quote_id = String::from_str(&env, "quote-001");
        client.mock_all_auths().charge(&user, &100_000_000i128, &quote_id);
        // Second charge for the SAME quote must be rejected (no double-deduct).
        client.mock_all_auths().charge(&user, &100_000_000i128, &quote_id);
    }

    #[test]
    fn test_charge_allows_distinct_quotes() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let q1 = String::from_str(&env, "quote-001");
        let q2 = String::from_str(&env, "quote-002");
        client.mock_all_auths().charge(&user, &100_000_000i128, &q1);
        client.mock_all_auths().charge(&user, &50_000_000i128, &q2);
        assert_eq!(client.balance(&user), 350_000_000i128);
    }

    #[test]
    fn test_refund_returns_surplus_to_user() {
        // Full settlement cycle: deposit → charge actual cost → refund surplus.
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract(token_admin);

        let contract_id = env.register(CreditEscrow, ());
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);

        // Deposit 500 USDC into escrow, then mint the same amount to the
        // contract so a refund transfer can pay out.
        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &500_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);
        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&contract_id, &500_000_000i128);

        let quote_id = String::from_str(&env, "quote-set");
        // Actual cost = 200; surplus = 300.
        client.mock_all_auths().charge(&user, &200_000_000i128, &quote_id);
        client.mock_all_auths().refund(&user, &300_000_000i128, &quote_id);

        // Escrow balance fully settled: 500 - 200 - 300 = 0.
        assert_eq!(client.balance(&user), 0);
        // User received the surplus back.
        let token_client = token::Client::new(&env, &asset);
        assert_eq!(token_client.balance(&user), 300_000_000i128);
        // Usage event recorded for the charge.
        assert_eq!(client.get_usage(&user, &0, &10).len(), 1);
    }

    #[test]
    #[should_panic(expected = "Quote already refunded")]
    fn test_refund_is_idempotent_per_quote() {
        let env = Env::default();
        let (_admin, user, _asset, client) = setup(&env);

        StellarAssetClient::new(&env, &_asset)            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let quote_id = String::from_str(&env, "quote-ref");
        client.mock_all_auths().refund(&user, &100_000_000i128, &quote_id);
        // Second refund for the SAME quote must be rejected.
        client.mock_all_auths().refund(&user, &100_000_000i128, &quote_id);
    }

    #[test]
    fn test_refund_requires_admin_auth() {
        let env = Env::default();
        let (_admin, user, _asset, client) = setup(&env);

        let quote_id = String::from_str(&env, "quote-auth");
        // Caller (empty auth) is not the admin → refund must fail.
        let result = client.try_refund(&user, &100_000_000i128, &quote_id);
        assert!(result.is_err());
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_refund_rejects_negative_amount() {
        let env = Env::default();
        let (_admin, user, _asset, client) = setup(&env);

        let quote_id = String::from_str(&env, "quote-neg");
        client.mock_all_auths().refund(&user, &-100i128, &quote_id);
    }

    #[test]
    #[should_panic(expected = "Insufficient prepaid balance")]
    fn test_refund_exceeding_balance_panics() {
        let env = Env::default();
        let (_admin, user, _asset, client) = setup(&env);

        StellarAssetClient::new(&env, &_asset)
            .mock_all_auths()
            .mint(&user, &500_000_000i128);
        client.mock_all_auths().deposit(&user, &100_000_000i128);

        let quote_id = String::from_str(&env, "quote-big");
        client.mock_all_auths().refund(&user, &200_000_000i128, &quote_id);
    }

    // ── Revenue withdrawal tests ──────────────────

    #[test]
    fn test_withdraw_revenue_transfers_to_destination() {
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);
        let revenue_dest = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let q = String::from_str(&env, "q-rev");
        client.mock_all_auths().charge(&user, &200_000_000i128, &q);
        assert_eq!(client.get_revenue(), 200_000_000i128);

        client.mock_all_auths().withdraw_revenue(&revenue_dest, &200_000_000i128);

        let token_client = token::Client::new(&env, &asset);
        assert_eq!(token_client.balance(&revenue_dest), 200_000_000i128);
        assert_eq!(client.get_revenue(), 0);
    }

    #[test]
    fn test_revenue_accumulates_across_multiple_charges() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &2_000_000_000i128);
        client.mock_all_auths().deposit(&user, &1_000_000_000i128);

        let q1 = String::from_str(&env, "q1");
        let q2 = String::from_str(&env, "q2");
        client.mock_all_auths().charge(&user, &100_000_000i128, &q1);
        client.mock_all_auths().charge(&user, &50_000_000i128, &q2);

        assert_eq!(client.get_revenue(), 150_000_000i128);
    }

    #[test]
    fn test_revenue_accumulates_from_multiple_users() {
        let env = Env::default();
        let (_admin, user1, asset, client) = setup(&env);
        let user2 = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user1, &1_000_000_000i128);
        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user2, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user1, &300_000_000i128);
        client.mock_all_auths().deposit(&user2, &500_000_000i128);

        let q1 = String::from_str(&env, "q1");
        let q2 = String::from_str(&env, "q2");
        client.mock_all_auths().charge(&user1, &100_000_000i128, &q1);
        client.mock_all_auths().charge(&user2, &200_000_000i128, &q2);

        assert_eq!(client.get_revenue(), 300_000_000i128);
    }

    #[test]
    fn test_partial_revenue_withdrawal() {
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);
        let dest = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let q = String::from_str(&env, "q");
        client.mock_all_auths().charge(&user, &300_000_000i128, &q);
        assert_eq!(client.get_revenue(), 300_000_000i128);

        // Withdraw only part of the revenue.
        client.mock_all_auths().withdraw_revenue(&dest, &100_000_000i128);
        assert_eq!(client.get_revenue(), 200_000_000i128);
        let token_client = token::Client::new(&env, &asset);
        assert_eq!(token_client.balance(&dest), 100_000_000i128);
    }

    #[test]
    fn test_withdraw_revenue_requires_admin_auth() {
        let env = Env::default();
        let (_admin, _user, _asset, client) = setup(&env);
        let dest = Address::generate(&env);

        let result = client.try_withdraw_revenue(&dest, &100_000_000i128);
        assert!(result.is_err());
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_withdraw_revenue_rejects_zero_amount() {
        let env = Env::default();
        let (_admin, _user, _asset, client) = setup(&env);
        let dest = Address::generate(&env);

        client.mock_all_auths().withdraw_revenue(&dest, &0i128);
    }

    #[test]
    #[should_panic(expected = "Insufficient accumulated revenue")]
    fn test_withdraw_revenue_exceeding_accumulated_panics() {
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);
        let dest = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let q = String::from_str(&env, "q");
        client.mock_all_auths().charge(&user, &100_000_000i128, &q);
        assert_eq!(client.get_revenue(), 100_000_000i128);

        // Try to withdraw more than has been accumulated.
        client.mock_all_auths().withdraw_revenue(&dest, &200_000_000i128);
    }

    #[test]
    fn test_withdraw_revenue_blocked_when_paused() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);
        let dest = Address::generate(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        let q = String::from_str(&env, "q");
        client.mock_all_auths().charge(&user, &100_000_000i128, &q);

        client.mock_all_auths().set_paused(&true);
        let result = client.try_withdraw_revenue(&dest, &50_000_000i128);
        assert!(result.is_err());
        // Revenue is not consumed on failed withdrawal.
        assert_eq!(client.get_revenue(), 100_000_000i128);
    }

    // ── Governance tests ──────────────────────────

    #[test]
    fn test_set_admin_transfers_control() {
        let env = Env::default();
        let (admin, user, asset, client) = setup(&env);
        let new_admin = Address::generate(&env);

        client.mock_all_auths().set_admin(&new_admin);

        // Old admin can no longer pause; new admin can.
        let result = client.try_set_paused(&true);
        assert!(result.is_err());

        client.mock_all_auths().set_paused(&true);
    }

    #[test]
    fn test_set_paused_blocks_mutations() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        client.mock_all_auths().set_paused(&true);

        // Deposit, withdraw and charge must all fail while paused.
        let dep = client.try_deposit(&user, &100_000_000i128);
        assert!(dep.is_err());
        let wd = client.try_withdraw(&user, &100_000_000i128);
        assert!(wd.is_err());
        let quote_id = String::from_str(&env, "quote-paused");
        let ch = client.try_charge(&user, &100_000_000i128, &quote_id);
        assert!(ch.is_err());

        // Balance unchanged.
        assert_eq!(client.balance(&user), 500_000_000i128);

        client.mock_all_auths().set_paused(&false);
        client.mock_all_auths().withdraw(&user, &100_000_000i128);
        assert_eq!(client.balance(&user), 400_000_000i128);
    }

    // ── Storage TTL tests ────────────────────────

    #[test]
    fn test_ttl_extended_after_init() {
        // The network default persistent TTL is only ~4096 ledgers. `init`
        // must explicitly extend the instance + code TTL far past that, or
        // the contract would be archived within hours.
        let env = Env::default();
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract(token_admin);

        // Register CreditEscrow last so it is the "current contract" whose
        // instance TTL the test reads below.
        let contract_id = env.register(CreditEscrow, ());
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);

        // Storage access from tests must run in the contract's context.
        let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(
            ttl >= LEDGERS_TO_LIVE,
            "contract instance TTL was not extended past the network default"
        );
    }

    #[test]
    fn test_balance_survives_default_ttl() {
        // Without explicit TTL extension a deposit balance would be archived
        // after ~4096 ledgers. Jump well past that and verify the balance is
        // still readable (a read of an archived entry errors in tests).
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract(token_admin);

        // Register CreditEscrow last so it is the "current contract" whose
        // instance TTL the test reads below.
        let contract_id = env.register(CreditEscrow, ());
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &1_000_000_000i128);
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        // The write path itself must extend the instance TTL — not just init.
        let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(
            ttl >= LEDGERS_TO_LIVE,
            "deposit did not extend the instance TTL"
        );

        // Jump 100k ledgers (>> the ~4096 default TTL, < LEDGERS_TO_LIVE).
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 100_000);

        assert_eq!(client.balance(&user), 500_000_000i128);
    }
}
