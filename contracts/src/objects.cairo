use starknet::ContractAddress;

/// Matches `privacy::objects::OpenNoteDeposit`. The pool deserializes the helper
/// return value as `Span<OpenNoteDeposit>`; an empty span means "credit nothing".
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}
