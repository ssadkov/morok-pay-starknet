use morok_pay::objects::OpenNoteDeposit;

/// Probe helper: the smallest `privacy_invoke` that logs its caller and credits nothing.
/// Used to confirm Ready will sign `[transfer, invoke]` against an unfamiliar contract
/// and to record which address the pool uses as `get_caller_address()`.
#[starknet::interface]
pub trait IEchoHelper<T> {
    fn privacy_invoke(ref self: T) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod EchoHelper {
    use morok_pay::objects::OpenNoteDeposit;
    use starknet::{ContractAddress, get_caller_address};
    use super::IEchoHelper;

    #[storage]
    struct Storage {}

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Invoked: Invoked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Invoked {
        #[key]
        pub caller: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    pub impl EchoHelperImpl of IEchoHelper<ContractState> {
        fn privacy_invoke(ref self: ContractState) -> Span<OpenNoteDeposit> {
            self.emit(Invoked { caller: get_caller_address() });
            [].span()
        }
    }
}
