use morok_pay::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// Domain-separated Poseidon tag. The commitment itself is built off-chain and
/// only used here as a key, so how it is salted is the app's business - this
/// contract never recomputes it. That is the difference from V1, where the
/// commitment *was* the authorisation.
pub const ESCROW_V2_TAG: felt252 = 'MOROK_ESCROW:V2';

/// Who may take the money, and when it stops being theirs to take.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct EscrowEntry {
    pub token: ContractAddress,
    pub amount: u128,
    /// Claims before `expires_at`. For a bearer link this is an ephemeral
    /// account derived from the link's own seed, so "to an address" and "to a
    /// link" are one rule rather than two.
    pub owner: ContractAddress,
    /// Takes it back after `expires_at`, and nobody else ever.
    pub refund_owner: ContractAddress,
    /// Unix seconds. Zero means the entry never expires and can never be
    /// refunded - deliberately expressible, deliberately not the default the
    /// app offers.
    pub expires_at: u64,
    pub claimed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Deposit,
}

#[starknet::interface]
pub trait IMorokEscrowV2<T> {
    /// Called by the pool through `privacy_invoke`, and only for deposits.
    ///
    /// Claiming is not here: the pool does not tell a helper who authorised
    /// the action set it is running, so a claim reached this way could not be
    /// checked against `owner`. It is an ordinary external instead, and the
    /// owner's own account calls it - relayed and paid for by somebody else,
    /// but signed by them.
    fn privacy_invoke(
        ref self: T,
        operation: EscrowOperation,
        commitment: felt252,
        token: ContractAddress,
        amount: u128,
        owner: ContractAddress,
        refund_owner: ContractAddress,
        expires_at: u64,
        indexed: bool,
    ) -> Span<OpenNoteDeposit>;

    /// Take the money. Caller must be `owner`, and `destination` is free so a
    /// claimer can send it straight on - to a bridge, an exchange, anywhere -
    /// rather than parking it in the account first.
    fn claim(ref self: T, commitment: felt252, destination: ContractAddress);

    /// Take it back once it has expired. Caller must be `refund_owner`.
    fn refund(ref self: T, commitment: felt252, destination: ContractAddress);

    fn get_entry(self: @T, commitment: felt252) -> EscrowEntry;
    fn escrowed_total(self: @T, token: ContractAddress) -> u128;
    fn minimum_amount(self: @T, token: ContractAddress) -> u128;
    fn privacy_contract(self: @T) -> ContractAddress;

    /// Discovery, for entries whose sender opted into it. A salted commitment
    /// is unfindable without the link that carries the salt; this hands it
    /// over for the one product that has no link - and, unavoidably, to anyone
    /// else who asks about the same address.
    fn entry_count(self: @T, owner: ContractAddress) -> u32;
    fn entry_at(self: @T, owner: ContractAddress, index: u32) -> felt252;
}

pub mod errors {
    pub const ZERO_POOL: felt252 = 'ZERO_POOL';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const ZERO_OWNER: felt252 = 'ZERO_OWNER';
    pub const ZERO_REFUND_OWNER: felt252 = 'ZERO_REFUND_OWNER';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
    pub const CALLER_NOT_OWNER: felt252 = 'CALLER_NOT_OWNER';
    pub const CALLER_NOT_REFUND_OWNER: felt252 = 'CALLER_NOT_REFUND_OWNER';
    pub const NOT_FUNDED: felt252 = 'NOT_FUNDED';
    pub const EXPIRED: felt252 = 'EXPIRED';
    pub const NOT_EXPIRED: felt252 = 'NOT_EXPIRED';
    pub const NO_EXPIRY: felt252 = 'NO_EXPIRY';
    pub const BELOW_MINIMUM: felt252 = 'BELOW_MINIMUM';
    pub const INDEX_OUT_OF_RANGE: felt252 = 'INDEX_OUT_OF_RANGE';
}

#[starknet::interface]
pub trait IERC20<T> {
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
}

/// Deferred delivery for a private payment, owned by an address.
///
/// V1 authorised a claim by knowledge of a secret. That cannot be relayed
/// safely - the claim reveals the secret in calldata while the destination is
/// chosen by whoever submits, so a submitter can redirect the money. Here the
/// only rule is `get_caller_address() == owner`, which an EVM holder satisfies
/// through their derived account without the app ever holding a secret that
/// could be replayed against them.
///
/// The parked tokens are plain ERC-20, so the amount and the token are public
/// between deposit and claim. Whether the *owner* is public is the sender's
/// choice, through `indexed`.
#[starknet::contract]
pub mod MorokEscrowV2 {
    use core::num::traits::Zero;
    use morok_pay::objects::OpenNoteDeposit;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address,
    };
    use super::{
        EscrowEntry, EscrowOperation, IERC20Dispatcher, IERC20DispatcherTrait, IMorokEscrowV2,
        errors,
    };

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        /// Per token, because one number cannot serve both: USDC has six
        /// decimals and STRK eighteen, so a single floor is wrong for one of
        /// them by twelve orders of magnitude. Unlisted tokens have no floor.
        ///
        /// It exists because a sponsored account deploy is given away on the
        /// strength of an unclaimed entry existing, so without a floor a cent
        /// buys one. The pool's own fee makes that uneconomic today, which is
        /// the pool's accident and not a defence this contract built.
        minimum_amount: Map<ContractAddress, u128>,
        entries: Map<felt252, EscrowEntry>,
        /// Unclaimed amount per token, so a deposit cannot book more than the
        /// pool actually sent.
        totals: Map<ContractAddress, u128>,
        entry_counts: Map<ContractAddress, u32>,
        entry_index: Map<(ContractAddress, u32), felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Escrowed: Escrowed,
        Claimed: Claimed,
        Refunded: Refunded,
    }

    /// `owner` is deliberately absent. An indexed entry publishes it through
    /// `entry_at` because it has to; an unindexed one should not have it
    /// handed to a log reader for free.
    #[derive(Drop, starknet::Event)]
    pub struct Escrowed {
        #[key]
        pub commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Refunded {
        #[key]
        pub commitment: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_contract: ContractAddress,
        minimums: Span<(ContractAddress, u128)>,
    ) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_POOL);
        self.privacy_contract.write(privacy_contract);
        let mut rest = minimums;
        loop {
            match rest.pop_front() {
                Option::Some(pair) => {
                    let (token, minimum) = *pair;
                    self.minimum_amount.write(token, minimum);
                },
                Option::None => { break; },
            }
        }
    }

    #[abi(embed_v0)]
    pub impl MorokEscrowV2Impl of IMorokEscrowV2<ContractState> {
        fn privacy_contract(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }

        fn get_entry(self: @ContractState, commitment: felt252) -> EscrowEntry {
            self.entries.read(commitment)
        }

        fn escrowed_total(self: @ContractState, token: ContractAddress) -> u128 {
            self.totals.read(token)
        }

        fn minimum_amount(self: @ContractState, token: ContractAddress) -> u128 {
            self.minimum_amount.read(token)
        }

        fn entry_count(self: @ContractState, owner: ContractAddress) -> u32 {
            self.entry_counts.read(owner)
        }

        fn entry_at(self: @ContractState, owner: ContractAddress, index: u32) -> felt252 {
            assert(index < self.entry_counts.read(owner), errors::INDEX_OUT_OF_RANGE);
            self.entry_index.read((owner, index))
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: EscrowOperation,
            commitment: felt252,
            token: ContractAddress,
            amount: u128,
            owner: ContractAddress,
            refund_owner: ContractAddress,
            expires_at: u64,
            indexed: bool,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.privacy_contract.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_PRIVACY);

            match operation {
                EscrowOperation::Deposit => {
                    assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
                    assert(token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(amount.is_non_zero(), errors::ZERO_AMOUNT);
                    assert(amount >= self.minimum_amount.read(token), errors::BELOW_MINIMUM);
                    assert(owner.is_non_zero(), errors::ZERO_OWNER);
                    assert(refund_owner.is_non_zero(), errors::ZERO_REFUND_OWNER);

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
                    self
                        .entries
                        .write(
                            commitment,
                            EscrowEntry {
                                token, amount, owner, refund_owner, expires_at, claimed: false,
                            },
                        );

                    if indexed {
                        let next = self.entry_counts.read(owner);
                        self.entry_index.write((owner, next), commitment);
                        self.entry_counts.write(owner, next + 1);
                    }

                    self.emit(Escrowed { commitment, token, amount, expires_at });
                    [].span()
                },
            }
        }

        fn claim(ref self: ContractState, commitment: felt252, destination: ContractAddress) {
            let entry = self.take(commitment);
            assert(get_caller_address() == entry.owner, errors::CALLER_NOT_OWNER);
            // Zero means no expiry at all, so it can never be too late.
            if entry.expires_at != 0 {
                assert(get_block_timestamp() < entry.expires_at, errors::EXPIRED);
            }
            self.pay_out(commitment, entry, destination);
            self.emit(Claimed { commitment });
        }

        fn refund(ref self: ContractState, commitment: felt252, destination: ContractAddress) {
            let entry = self.take(commitment);
            assert(get_caller_address() == entry.refund_owner, errors::CALLER_NOT_REFUND_OWNER);
            // An entry with no expiry is never refundable - the sender chose
            // that when they created it, and it is why the app should not
            // offer it lightly.
            assert(entry.expires_at != 0, errors::NO_EXPIRY);
            assert(get_block_timestamp() >= entry.expires_at, errors::NOT_EXPIRED);
            self.pay_out(commitment, entry, destination);
            self.emit(Refunded { commitment });
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        /// The checks both exits share, before either of them looks at who is
        /// asking.
        fn take(self: @ContractState, commitment: felt252) -> EscrowEntry {
            let entry = self.entries.read(commitment);
            assert(entry.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
            assert(!entry.claimed, errors::ALREADY_CLAIMED);
            entry
        }

        /// Marked claimed before the transfer, so a token that calls back
        /// cannot take the same entry twice.
        fn pay_out(
            ref self: ContractState,
            commitment: felt252,
            entry: EscrowEntry,
            destination: ContractAddress,
        ) {
            assert(destination.is_non_zero(), errors::ZERO_OWNER);
            self.entries.write(commitment, EscrowEntry { claimed: true, ..entry });
            self.totals.write(entry.token, self.totals.read(entry.token) - entry.amount);
            IERC20Dispatcher { contract_address: entry.token }
                .transfer(destination, entry.amount.into());
        }
    }
}
