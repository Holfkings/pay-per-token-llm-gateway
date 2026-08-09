//! x402 Credit Escrow — Soroban Smart Contract (v2)
//!
//! Holds prepaid credit balances for callers. Balances are drawn down
//! per verified usage event instead of requiring a payment per request.
//!
//! Security considerations:
//! - Only the gateway admin can decrement balances (via authorized usage events)
//! - Users can deposit and withdraw their own funds at any time
//! - Balances are denominated in the smallest asset unit (e.g., stroops)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol, Vec,
};

// ── Types ────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ContractConfig {
    pub admin: Address,
    pub asset: Address, // Token contract address
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

// ── Contract ─────────────────────────────────

#[contract]
pub struct CreditEscrow;

#[contractimpl]
impl CreditEscrow {
    /// Initialize the contract.
    pub fn init(env: Env, admin: Address, asset: Address) {
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

    /// Deposit tokens into escrow. Caller must have approved the token transfer.
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();

        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        if config.paused {
            panic!("Contract is paused");
        }

        // Transfer tokens from user to this contract
        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        // Update balance
        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&balance_key, &(current + amount));

        emit_deposit(&env, &user, amount);
    }

    /// Withdraw tokens from escrow.
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();

        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);

        if current < amount {
            panic!("Insufficient balance");
        }

        env.storage()
            .instance()
            .set(&balance_key, &(current - amount));

        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        emit_withdrawal(&env, &user, amount);
    }

    /// Deduct credits for a usage event. Only callable by admin (gateway).
    pub fn charge(env: Env, user: Address, amount: i128, quote_id: String) {
        let config: ContractConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        config.admin.require_auth();

        let balance_key = (BALANCES_KEY, user.clone());
        let current: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);

        if current < amount {
            panic!("Insufficient prepaid balance");
        }

        env.storage()
            .instance()
            .set(&balance_key, &(current - amount));

        // Record usage
        let usage_event = UsageEvent {
            user: user.clone(),
            amount,
            quote_id: quote_id.clone(),
            timestamp: env.ledger().timestamp(),
        };

        let usage_key = (USAGE_KEY, user.clone());
        let mut events: Vec<UsageEvent> = env
            .storage()
            .instance()
            .get(&usage_key)
            .unwrap_or_else(|| Vec::new(&env));
        events.push_back(usage_event);
        env.storage().instance().set(&usage_key, &events);

        emit_usage(&env, &user, amount, quote_id);
    }

    /// Check a user's balance.
    pub fn balance(env: Env, user: Address) -> i128 {
        let balance_key = (BALANCES_KEY, user);
        env.storage().instance().get(&balance_key).unwrap_or(0)
    }

    /// Get usage history for a user.
    pub fn get_usage(env: Env, user: Address, offset: u32, limit: u32) -> Vec<UsageEvent> {
        let usage_key = (USAGE_KEY, user);
        let events: Vec<UsageEvent> = env
            .storage()
            .instance()
            .get(&usage_key)
            .unwrap_or_else(|| Vec::new(&env));
        let mut result = Vec::new(&env);
        let start = offset;
        let end = (offset + limit).min(events.len());

        for i in start..end {
            if let Some(e) = events.get(i) {
                result.push_back(e);
            }
        }
        result
    }
}

// ── Tests ────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::StellarAssetClient;

    fn setup(env: &Env) -> (Address, Address, Address, CreditEscrowClient) {
        let admin = Address::generate(env);
        let user = Address::generate(env);

        // Deploy a real Stellar Asset Contract instead of a mock address
        let token_admin = Address::generate(env);
        let asset = env.register_stellar_asset_contract(token_admin);

        let contract_id = env.register_contract(None, CreditEscrow);
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

        // Mint tokens to the user so the SAC transfer succeeds
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

        // Withdraw half
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

        // Deposit some credits
        client.mock_all_auths().deposit(&user, &500_000_000i128);

        // Admin charges for usage
        let quote_id = String::from_str(&env, "quote-001");
        client
            .mock_all_auths()
            .charge(&user, &100_000_000i128, &quote_id);

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
        client
            .mock_all_auths()
            .charge(&user, &500_000_000i128, &quote_id);
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

        let second = usage.get(1).unwrap();
        assert_eq!(second.amount, 200_000_000i128);
        assert_eq!(second.quote_id, q2);
    }

    #[test]
    fn test_usage_pagination() {
        let env = Env::default();
        let (_admin, user, asset, client) = setup(&env);

        StellarAssetClient::new(&env, &asset)
            .mock_all_auths()
            .mint(&user, &2_000_000_000i128);

        client.mock_all_auths().deposit(&user, &1_000_000_000i128);

        // Create 5 charges
        for i in 0..5 {
            let quote_str = ["quote-000", "quote-001", "quote-002", "quote-003", "quote-004"][i as usize];
            let quote = String::from_str(&env, quote_str);
            client
                .mock_all_auths()
                .charge(&user, &(10_000_000 * (i + 1) as i128), &quote);
        }

        // Page 1: first 2
        let page1 = client.get_usage(&user, &0, &2);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().amount, 10_000_000);

        // Page 2: next 2
        let page2 = client.get_usage(&user, &2, &2);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().amount, 30_000_000);
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

        let contract_id = env.register_contract(None, CreditEscrow);
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);
        client.init(&admin, &asset);
    }
}
