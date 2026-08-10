//! x402 Multi-Signature Wallet — Soroban Smart Contract
//!
//! Optional contract for provider payout wallet security.
//! Requires M-of-N signatures to authorize payouts.
//!
//! Use case: Provider wants to require multiple signers
//! before transferring accumulated gateway revenue to their wallet.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct MultisigConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
    pub token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u32,
    pub destination: Address,
    pub amount: i128,
    pub executed: bool,
    pub approvals: Vec<Address>,
    pub createdAt: u64,
}

const CONFIG_KEY: Symbol = symbol_short!("CONFIG");
const PROPOSALS_KEY: Symbol = symbol_short!("PROPS");
const PROPOSAL_COUNT_KEY: Symbol = symbol_short!("PROPCT");

// ── Events ───────────────────────────────────

fn emit_proposed(env: &Env, proposal_id: u32, destination: &Address, amount: i128) {
    let topics = (symbol_short!("proposed"), proposal_id);
    env.events().publish(topics, (destination.clone(), amount));
}

fn emit_approved(env: &Env, proposal_id: u32, signer: &Address) {
    let topics = (symbol_short!("approved"), proposal_id);
    env.events().publish(topics, signer.clone());
}

fn emit_executed(env: &Env, proposal_id: u32, destination: &Address, amount: i128) {
    let topics = (symbol_short!("executed"), proposal_id);
    env.events().publish(topics, (destination.clone(), amount));
}

#[contract]
pub struct Multisig;

#[contractimpl]
impl Multisig {
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32, token: Address) {
        // Prevent re-initialization: `init` may only be called once. Without
        // this guard, anyone could re-initialize the contract with their own
        // signer set (threshold = 1) and drain every token it holds.
        if env.storage().instance().has(&CONFIG_KEY) {
            panic!("Contract already initialized");
        }

        // Validate threshold
        if threshold == 0 {
            panic!("Threshold must be at least 1");
        }
        if threshold > signers.len() as u32 {
            panic!("Threshold cannot exceed number of signers");
        }
        if !has_unique_signers(&signers) {
            panic!("Duplicate signers are not allowed");
        }

        let config = MultisigConfig {
            signers,
            threshold,
            token,
        };
        env.storage().instance().set(&CONFIG_KEY, &config);
        env.storage().instance().set(&PROPOSAL_COUNT_KEY, &0u32);
    }

    pub fn propose(env: Env, destination: Address, amount: i128) -> u32 {
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let mut count: u32 = env
            .storage()
            .instance()
            .get(&PROPOSAL_COUNT_KEY)
            .unwrap();
        let proposal_id = count;
        count += 1;
        env.storage().instance().set(&PROPOSAL_COUNT_KEY, &count);

        let proposal = Proposal {
            id: proposal_id,
            destination,
            amount,
            executed: false,
            approvals: Vec::new(&env),
            createdAt: env.ledger().timestamp(),
        };

        let proposals_key = (PROPOSALS_KEY, proposal_id);
        env.storage().instance().set(&proposals_key, &proposal);

        emit_proposed(&env, proposal_id, &proposal.destination, proposal.amount);

        proposal_id
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u32) {
        signer.require_auth();

        let config: MultisigConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();
        if !config.signers.contains(&signer) {
            panic!("Not an authorized signer");
        }

        let proposals_key = (PROPOSALS_KEY, proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&proposals_key)
            .unwrap();

        if proposal.executed {
            panic!("Proposal already executed");
        }

        // Record the approval exactly once and emit the event. A signer who
        // has already approved is a no-op (no duplicate pushes, no duplicate
        // events).
        if !proposal.approvals.contains(&signer) {
            proposal.approvals.push_back(signer.clone());
            emit_approved(&env, proposal_id, &signer);
        }

        if proposal.approvals.len() >= config.threshold && !proposal.executed {
            proposal.executed = true;

            // Execute transfer
            let token_client = token::Client::new(&env, &config.token);
            token_client.transfer(
                &env.current_contract_address(),
                &proposal.destination,
                &proposal.amount,
            );
            emit_executed(&env, proposal_id, &proposal.destination, proposal.amount);
        }

        env.storage().instance().set(&proposals_key, &proposal);
    }

    /// Rotate the signer set. Any one of the current signers may authorize the
    /// rotation by passing themselves as `signer`; the new threshold is
    /// validated against the new signer list.
    pub fn set_signers(env: Env, signer: Address, new_signers: Vec<Address>, new_threshold: u32) {
        let mut config: MultisigConfig = env.storage().instance().get(&CONFIG_KEY).unwrap();

        // Gate: `signer` must authorize the call and be a current signer
        // (any-of-N rather than requiring every signer to approve).
        signer.require_auth();
        if !config.signers.contains(&signer) {
            panic!("Not an authorized signer");
        }

        if new_threshold == 0 {
            panic!("Threshold must be at least 1");
        }
        if new_threshold > new_signers.len() as u32 {
            panic!("Threshold cannot exceed number of signers");
        }
        if !has_unique_signers(&new_signers) {
            panic!("Duplicate signers are not allowed");
        }

        config.signers = new_signers;
        config.threshold = new_threshold;
        env.storage().instance().set(&CONFIG_KEY, &config);
    }

    pub fn get_proposal(env: Env, proposal_id: u32) -> Proposal {
        let proposals_key = (PROPOSALS_KEY, proposal_id);
        env.storage().instance().get(&proposals_key).unwrap()
    }

    /// Total number of proposals ever created.
    pub fn get_proposal_count(env: Env) -> u32 {
        env.storage().instance().get(&PROPOSAL_COUNT_KEY).unwrap_or(0)
    }

    /// Paginated proposal listing — O(limit) reads, bounded gas.
    pub fn get_proposals(env: Env, offset: u32, limit: u32) -> Vec<Proposal> {
        let count: u32 = env.storage().instance().get(&PROPOSAL_COUNT_KEY).unwrap_or(0);
        let mut result = Vec::new(&env);
        let end = (offset + limit).min(count);
        for i in offset..end {
            let proposals_key = (PROPOSALS_KEY, i);
            if let Some(p) = env.storage().instance().get(&proposals_key) {
                result.push_back(p);
            }
        }
        result
    }

    pub fn get_config(env: Env) -> MultisigConfig {
        env.storage().instance().get(&CONFIG_KEY).unwrap()
    }
}

/// True when every element of `signers` is distinct.
fn has_unique_signers(signers: &Vec<Address>) -> bool {
    for i in 0..signers.len() {
        for j in (i + 1)..signers.len() {
            if signers.get(i).unwrap() == signers.get(j).unwrap() {
                return false;
            }
        }
    }
    true
}

// ── Tests ────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::StellarAssetClient;

    #[test]
    fn test_init_with_valid_signers() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &1u32, &token);

        let config = client.get_config();
        assert_eq!(config.signers.len(), 2);
        assert_eq!(config.threshold, 1);
        assert_eq!(config.token, token);
    }

    #[test]
    #[should_panic(expected = "Threshold must be at least 1")]
    fn test_init_with_zero_threshold() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &0u32, &token);
    }

    #[test]
    #[should_panic(expected = "Threshold cannot exceed number of signers")]
    fn test_init_with_threshold_exceeding_signers() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &5u32, &token);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_double_init_rejected() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        // Attack scenario: a second `init` with an attacker-controlled signer
        // set and threshold 1 must be rejected, otherwise the contract could
        // be taken over and drained.
        let attacker = Address::generate(&env);
        let attacker_signers = Vec::from_array(&env, [attacker.clone()]);
        client.init(&attacker_signers, &1u32, &token);
    }

    #[test]
    fn test_propose_creates_proposal() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        let proposal_id = client.propose(&destination, &100_000_000i128);
        assert_eq!(proposal_id, 0);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.id, 0);
        assert_eq!(proposal.destination, destination);
        assert_eq!(proposal.amount, 100_000_000i128);
        assert!(!proposal.executed);
        assert_eq!(proposal.approvals.len(), 0);
    }

    #[test]
    #[should_panic(expected = "Not an authorized signer")]
    fn test_unauthorized_approver_rejected() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let outsider = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        let proposal_id = client.propose(&destination, &100_000_000i128);

        // outsider is not in the signer list
        client.mock_all_auths().approve(&outsider, &proposal_id);
    }

    #[test]
    fn test_multiple_approvals() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let destination = Address::generate(&env);

        // Deploy a real SAC token and mint funds to the multisig contract
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin.clone());

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        // Mint tokens to the multisig contract so it can transfer when executed
        StellarAssetClient::new(&env, &token)
            .mock_all_auths()
            .mint(&contract_id, &1_000_000_000i128);

        let proposal_id = client.propose(&destination, &100_000_000i128);

        // First approval
        client.mock_all_auths().approve(&signer1, &proposal_id);
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 1);
        assert!(!proposal.executed);

        // Second approval should trigger execution
        client.mock_all_auths().approve(&signer2, &proposal_id);
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 2);
        assert!(proposal.executed);
    }

    #[test]
    #[should_panic(expected = "Proposal already executed")]
    fn test_double_execute_prevented() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let destination = Address::generate(&env);

        // Deploy a real SAC token and mint funds to the multisig contract
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin.clone());

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        // Mint tokens to the multisig contract so it can transfer when executed
        StellarAssetClient::new(&env, &token)
            .mock_all_auths()
            .mint(&contract_id, &1_000_000_000i128);

        let proposal_id = client.propose(&destination, &100_000_000i128);

        client.mock_all_auths().approve(&signer1, &proposal_id);
        client.mock_all_auths().approve(&signer2, &proposal_id);

        // Third approval should panic
        client.mock_all_auths().approve(&signer1, &proposal_id);
    }

    #[test]
    fn test_proposal_increments() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &1u32, &token);

        let id1 = client.propose(&destination, &10i128);
        let id2 = client.propose(&destination, &20i128);

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);

        let p1 = client.get_proposal(&0);
        let p2 = client.get_proposal(&1);
        assert_eq!(p1.amount, 10);
        assert_eq!(p2.amount, 20);
    }

    // ── Authorization & rotation tests ───────────

    #[test]
    fn test_approve_requires_signer_auth() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        let proposal_id = client.propose(&destination, &100_000_000i128);

        // Unauthenticated approval → require_auth() must fail.
        let result = client.try_approve(&signer1, &proposal_id);
        assert!(result.is_err());
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 0);
        assert!(!proposal.executed);
    }

    #[test]
    #[should_panic(expected = "Duplicate signers are not allowed")]
    fn test_duplicate_signers_rejected() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &1u32, &token);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_propose_rejects_non_positive_amount() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &1u32, &token);

        client.propose(&destination, &0i128);
    }

    #[test]
    fn test_rotation_updates_signers_and_threshold() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

        // A current signer rotates the set.
        let new_signers = Vec::from_array(&env, [signer2.clone(), signer3.clone()]);
        client.mock_all_auths().set_signers(&signer1, &new_signers, &1u32);

        let config = client.get_config();
        assert_eq!(config.signers.len(), 2);
        assert_eq!(config.threshold, 1);

        // An outsider (not a current signer) cannot rotate, even with auth.
        let outsider = Address::generate(&env);
        let outsider_signers = Vec::from_array(&env, [outsider.clone()]);
        let result = client.try_set_signers(&outsider, &outsider_signers, &1u32);
        assert!(result.is_err());
    }

    #[test]
    fn test_proposal_enumeration() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone()]);

        let contract_id = env.register(Multisig, ());
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &1u32, &token);

        client.propose(&destination, &10i128);
        client.propose(&destination, &20i128);
        client.propose(&destination, &30i128);

        assert_eq!(client.get_proposal_count(), 3);

        let page = client.get_proposals(&1, &2);
        assert_eq!(page.len(), 2);
        assert_eq!(page.get(0).unwrap().amount, 20);
        assert_eq!(page.get(1).unwrap().amount, 30);
    }
}
