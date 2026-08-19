use morok_pay::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// Domain-separated Poseidon commitment over a claim secret.
///
/// `commitment = poseidon([ESCROW_TAG, secret])`
pub const ESCROW_TAG: felt252 = 'MOROK_ESCROW:V1';

pub fn compute_escrow_commitment(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([ESCROW_TAG, secret].span())
}

/// What the pool parked here, and whether it has been taken.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct EscrowEntry {
    pub token: ContractAddress,
    pub amount: u128,
    pub claimed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Deposit,
    Claim,
}

#[starknet::interface]
pub trait IMorokEscrow<T> {
    /// Called by the pool through `privacy_invoke`.
    ///
    /// `Deposit` records a commitment backed by tokens the pool has already
    /// withdrawn here; `token` and `amount` describe them and `secret` and
    /// `note_id` are ignored.
    ///
    /// `Claim` proves knowledge of the secret, hands the tokens back to the
    /// pool, and asks it to credit the claimer's open note; `commitment`,
    /// `token` and `amount` are ignored.
    fn privacy_invoke(
        ref self: T,
        operation: EscrowOperation,
        commitment: felt252,
        token: ContractAddress,
        amount: u128,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn get_entry(self: @T, commitment: felt252) -> EscrowEntry;
    fn escrowed_total(self: @T, token: ContractAddress) -> u128;
    fn privacy_contract(self: @T) -> ContractAddress;
}

pub mod errors {
    pub const ZERO_POOL: felt252 = 'ZERO_POOL';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
    pub const NOT_FUNDED: felt252 = 'NOT_FUNDED';
}

#[starknet::interface]
pub trait IERC20<T> {
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
}

/// Deferred delivery for a private payment.
///
/// The pool cannot credit a note to someone who has not registered a viewing
/// key, which makes a giveaway to strangers impossible. Here the sender parks
/// the tokens behind a hash and shares the preimage off-chain; the recipient
/// claims into their own note whenever they are ready.
///
/// The parked tokens are plain ERC-20, so the amount and the token are public
/// between deposit and claim. Neither address is.
#[starknet::contract]
pub mod MorokEscrow {
    use core::num::traits::Zero;
    use morok_pay::objects::OpenNoteDeposit;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        EscrowEntry, EscrowOperation, IERC20Dispatcher, IERC20DispatcherTrait, IMorokEscrow,
        compute_escrow_commitment, errors,
    };

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        entries: Map<felt252, EscrowEntry>,
        /// Unclaimed amount per token, so a deposit cannot claim more than the
        /// pool actually sent.
        totals: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Escrowed: Escrowed,
        Claimed: Claimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Escrowed {
        #[key]
        pub commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub commitment: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_contract: ContractAddress) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_POOL);
        self.privacy_contract.write(privacy_contract);
    }

    #[abi(embed_v0)]
    pub impl MorokEscrowImpl of IMorokEscrow<ContractState> {
        fn privacy_contract(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }

        fn get_entry(self: @ContractState, commitment: felt252) -> EscrowEntry {
            self.entries.read(commitment)
        }

        fn escrowed_total(self: @ContractState, token: ContractAddress) -> u128 {
            self.totals.read(token)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: EscrowOperation,
            commitment: felt252,
            token: ContractAddress,
            amount: u128,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.privacy_contract.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_PRIVACY);

            match operation {
                EscrowOperation::Deposit => {
                    assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
                    assert(token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

                    let existing = self.entries.read(commitment);
                    assert(existing.token.is_zero(), errors::COMMITMENT_EXISTS);

                    // The sender picks this calldata, so believing it would let
                    // them book an entry the pool never funded and drain the
                    // escrow through a claim.
                    let total = self.totals.read(token) + amount;
                    let held = IERC20Dispatcher { contract_address: token }
                        .balance_of(get_contract_address());
                    assert(held >= total.into(), errors::NOT_FUNDED);

                    self.totals.write(token, total);
                    self.entries.write(commitment, EscrowEntry { token, amount, claimed: false });
                    self.emit(Escrowed { commitment, token, amount });
                    [].span()
                },
                EscrowOperation::Claim => {
                    let commitment = compute_escrow_commitment(secret);
                    let entry = self.entries.read(commitment);
                    assert(entry.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
                    assert(!entry.claimed, errors::ALREADY_CLAIMED);

                    self.entries.write(commitment, EscrowEntry { claimed: true, ..entry });
                    self.totals.write(entry.token, self.totals.read(entry.token) - entry.amount);

                    IERC20Dispatcher { contract_address: entry.token }
                        .approve(pool, entry.amount.into());
                    self.emit(Claimed { commitment });

                    [OpenNoteDeposit { note_id, token: entry.token, amount: entry.amount }].span()
                },
            }
        }
    }
}
