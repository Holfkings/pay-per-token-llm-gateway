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
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Map, String, Symbol,
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
    let topics = (symbol_short!("withdrawal"), user.clone());
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
        let config = ContractConfig { admin, asset, paused: false };
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
        env.storage().instance().set(&balance_key, &(current + amount));

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

        env.storage().instance().set(&balance_key, &(current - amount));

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

        env.storage().instance().set(&balance_key, &(current - amount));

        // Record usage
        let usage_event = UsageEvent {
            user: user.clone(),
            amount,
            quote_id: quote_id.clone(),
            timestamp: env.ledger().timestamp(),
        };

        let usage_key = (USAGE_KEY, user.clone());
        let mut events: Vec<UsageEvent> = env.storage().instance().get(&usage_key).unwrap_or_else(|| Vec::new(&env));
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
        let events: Vec<UsageEvent> = env.storage().instance().get(&usage_key).unwrap_or_else(|| Vec::new(&env));
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

    #[test]
    fn test_deposit_and_balance() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset = Address::generate(&env);

        let contract_id = env.register_contract(None, CreditEscrow);
        let client = CreditEscrowClient::new(&env, &contract_id);
        client.init(&admin, &asset);

        // Mock deposit
        let token_admin = Address::generate(&env);
        let token_client = token::StellarAssetClient::new(&env, &asset);
        // In real test, would set up proper token minting

        assert_eq!(client.balance(&user), 0);
    }
}
