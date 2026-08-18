use morok_pay::objects::OpenNoteDeposit;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMorokInvoices<T> {
    fn privacy_invoke(ref self: T, commitment: felt252) -> Span<OpenNoteDeposit>;
    fn privacy_contract(self: @T) -> ContractAddress;
}

pub mod errors {
    pub const ZERO_POOL: felt252 = 'ZERO_POOL';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
}

#[starknet::contract]
pub mod MorokInvoices {
    use core::num::traits::Zero;
    use morok_pay::objects::OpenNoteDeposit;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::{IMorokInvoices, errors};

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        InvoiceSettled: InvoiceSettled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct InvoiceSettled {
        #[key]
        pub commitment: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_contract: ContractAddress) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_POOL);
        self.privacy_contract.write(privacy_contract);
    }

    #[abi(embed_v0)]
    pub impl MorokInvoicesImpl of IMorokInvoices<ContractState> {
        fn privacy_contract(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }

        fn privacy_invoke(ref self: ContractState, commitment: felt252) -> Span<OpenNoteDeposit> {
            assert(
                get_caller_address() == self.privacy_contract.read(), errors::CALLER_NOT_PRIVACY,
            );
            assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            self.emit(InvoiceSettled { commitment });
            [].span()
        }
    }
}
