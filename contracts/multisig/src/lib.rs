//! x402 Multi-Signature Wallet — Soroban Smart Contract
//!
//! Optional contract for provider payout wallet security.
//! Requires M-of-N signatures to authorize payouts.
//!
//! Use case: Provider wants to require multiple signers
//! before transferring accumulated gateway revenue to their wallet.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Map, String, Vec,
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

const CONFIG_KEY: symbol_short = symbol_short!("CONFIG");
const PROPOSALS_KEY: symbol_short = symbol_short!("PROPS");
const PROPOSAL_COUNT_KEY: symbol_short = symbol_short!("PROPCT");

#[contract]
pub struct Multisig;

#[contractimpl]
impl Multisig {
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32, token: Address) {
        let config = MultisigConfig { signers, threshold, token };
        env.storage().instance().set(&CONFIG_KEY, &config);
        env.storage().instance().set(&PROPOSAL_COUNT_KEY, &0u32);
    }

    pub fn propose(env: Env, destination: Address, amount: i128) -> u32 {
        let mut count: u32 = env.storage().instance().get(&PROPOSAL_COUNT_KEY).unwrap();
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
        let mut proposal: Proposal = env.storage().instance().get(&proposals_key).unwrap();

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
