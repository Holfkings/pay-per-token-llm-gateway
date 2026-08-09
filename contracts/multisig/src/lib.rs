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

#[contract]
pub struct Multisig;

#[contractimpl]
impl Multisig {
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32, token: Address) {
        // Validate threshold
        if threshold == 0 {
            panic!("Threshold must be at least 1");
        }
        if threshold > signers.len() as u32 {
            panic!("Threshold cannot exceed number of signers");
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

        if !proposal.approvals.contains(&signer) {
            proposal.approvals.push_back(signer);
        }

        if proposal.approvals.len() >= config.threshold {
            proposal.executed = true;

            // Execute transfer
            let token_client = token::Client::new(&env, &config.token);
            token_client.transfer(
                &env.current_contract_address(),
                &proposal.destination,
                &proposal.amount,
            );
        }

        env.storage().instance().set(&proposals_key, &proposal);
    }

    pub fn get_proposal(env: Env, proposal_id: u32) -> Proposal {
        let proposals_key = (PROPOSALS_KEY, proposal_id);
        env.storage().instance().get(&proposals_key).unwrap()
    }

    pub fn get_config(env: Env) -> MultisigConfig {
        env.storage().instance().get(&CONFIG_KEY).unwrap()
    }
}

// ── Tests ────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_init_with_valid_signers() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register_contract(None, Multisig);
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

        let contract_id = env.register_contract(None, Multisig);
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

        let contract_id = env.register_contract(None, Multisig);
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &5u32, &token);
    }

    #[test]
    fn test_propose_creates_proposal() {
        let env = Env::default();
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register_contract(None, Multisig);
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

        let contract_id = env.register_contract(None, Multisig);
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
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register_contract(None, Multisig);
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

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
        let token = Address::generate(&env);
        let destination = Address::generate(&env);

        let signers = Vec::from_array(&env, [signer1.clone(), signer2.clone()]);

        let contract_id = env.register_contract(None, Multisig);
        let client = MultisigClient::new(&env, &contract_id);
        client.init(&signers, &2u32, &token);

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

        let contract_id = env.register_contract(None, Multisig);
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
}
