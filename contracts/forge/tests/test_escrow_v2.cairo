use morok_pay::escrow_v2::{
    EscrowOperation, IMorokEscrowV2Dispatcher, IMorokEscrowV2DispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare,
    start_cheat_caller_address, start_cheat_block_timestamp,
};
use starknet::ContractAddress;

fn addr(value: felt252) -> ContractAddress { value.try_into().unwrap() }

#[starknet::interface]
trait IRevertHarness<T> {
    fn try_claim(ref self: T, escrow: ContractAddress) -> bool;
    fn try_refund(ref self: T, escrow: ContractAddress) -> bool;
}

// Catch inside an actual contract call: snforge top-level test dispatches do
// not provide the nested transactional state boundary exercised here.
#[starknet::contract]
mod RevertHarness {
    use morok_pay::escrow_v2::{EscrowOperation, IMorokEscrowV2SafeDispatcher, IMorokEscrowV2SafeDispatcherTrait};
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl HarnessImpl of super::IRevertHarness<ContractState> {
        #[feature("safe_dispatcher")]
        fn try_claim(ref self: ContractState, escrow: ContractAddress) -> bool {
            IMorokEscrowV2SafeDispatcher { contract_address: escrow }.claim(0xabc, 0x999.try_into().unwrap()).is_ok()
        }
        #[feature("safe_dispatcher")]
        fn try_refund(ref self: ContractState, escrow: ContractAddress) -> bool {
            let zero: ContractAddress = 0.try_into().unwrap();
            IMorokEscrowV2SafeDispatcher { contract_address: escrow }
                .privacy_invoke(EscrowOperation::Refund(0x777), 0xabc, zero, 0, zero, zero, 0, false).is_ok()
        }
    }
}

fn harness() -> IRevertHarnessDispatcher {
    let (address, _) = declare("RevertHarness").unwrap().contract_class().deploy(@array![]).unwrap();
    IRevertHarnessDispatcher { contract_address: address }
}

#[starknet::interface]
trait ITestToken<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn set_failures(ref self: T, transfer: bool, approve: bool);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn transfer(ref self: T, to: ContractAddress, amount: u256) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
mod TestToken {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        fail_transfer: bool,
        fail_approve: bool,
    }
    #[abi(embed_v0)]
    impl TokenImpl of super::ITestToken<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }
        fn set_failures(ref self: ContractState, transfer: bool, approve: bool) {
            self.fail_transfer.write(transfer);
            self.fail_approve.write(approve);
        }
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 { self.balances.read(account) }
        fn transfer(ref self: ContractState, to: ContractAddress, amount: u256) -> bool {
            if self.fail_transfer.read() { return false; }
            let caller = get_caller_address();
            self.balances.write(caller, self.balances.read(caller) - amount);
            self.balances.write(to, self.balances.read(to) + amount);
            true
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            !self.fail_approve.read()
        }
    }
}

fn setup(expiry: u64) -> (IMorokEscrowV2Dispatcher, ITestTokenDispatcher) {
    let (token_address, _) = declare("TestToken").unwrap().contract_class().deploy(@array![]).unwrap();
    let token = ITestTokenDispatcher { contract_address: token_address };
    let (escrow_address, _) = declare("MorokEscrowV2").unwrap().contract_class()
        .deploy(@array![0x100, 1, token_address.into(), 10]).unwrap();
    let escrow = IMorokEscrowV2Dispatcher { contract_address: escrow_address };
    token.mint(escrow_address, 100);
    start_cheat_caller_address(escrow_address, addr(0x100));
    escrow.privacy_invoke(EscrowOperation::Deposit, 0xabc, token_address, 100, addr(0x200), addr(0x300), expiry, false);
    (escrow, token)
}

fn authorize(escrow: IMorokEscrowV2Dispatcher, note: felt252) {
    start_cheat_block_timestamp(escrow.contract_address, 1000);
    start_cheat_caller_address(escrow.contract_address, addr(0x300));
    escrow.authorize_refund(0xabc, note);
}

#[test]
fn unindexed_is_public_but_recovery_is_separate() {
    let (escrow, _) = setup(1000);
    assert(escrow.entry_count(addr(0x200)) == 0, 'unexpected index');
    let entry = escrow.get_entry(0xabc);
    assert(entry.owner == addr(0x200), 'owner');
    assert(entry.refund_owner == addr(0x300), 'recovery account');
}

#[test]
fn private_refund_only_approves_the_exact_authorized_note() {
    let (escrow, token) = setup(1000);
    authorize(escrow, 0x777);
    start_cheat_caller_address(escrow.contract_address, addr(0x100));
    let notes = escrow.privacy_invoke(EscrowOperation::Refund(0x777), 0xabc, addr(0), 0, addr(0), addr(0), 0, false);
    assert(notes.len() == 1, 'one note');
    let note = *notes.at(0);
    assert(note.note_id == 0x777, 'bound note');
    assert(note.token == token.contract_address, 'bound token');
    assert(note.amount == 100, 'full refund');
    assert(escrow.get_entry(0xabc).claimed, 'closed');
    assert(escrow.escrowed_total(token.contract_address) == 0, 'obligations cleared');
    assert(escrow.refund_note(0xabc) == 0, 'authorization consumed');
    assert(token.balance_of(addr(0x300)) == 0, 'no public refund');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_REFUND_OWNER')]
fn stranger_cannot_authorize() {
    let (escrow, _) = setup(1000);
    start_cheat_block_timestamp(escrow.contract_address, 1000);
    start_cheat_caller_address(escrow.contract_address, addr(0x999));
    escrow.authorize_refund(0xabc, 0x777);
}

#[test]
#[should_panic(expected: 'NOT_EXPIRED')]
fn refund_before_expiry_is_refused() {
    let (escrow, _) = setup(1001);
    authorize(escrow, 0x777);
}

#[test]
#[should_panic(expected: 'NO_EXPIRY')]
fn perpetual_entry_cannot_be_refunded() {
    let (escrow, _) = setup(0);
    authorize(escrow, 0x777);
}

#[test]
#[should_panic(expected: 'ZERO_NOTE')]
fn zero_note_cannot_be_authorized() {
    let (escrow, _) = setup(1000);
    authorize(escrow, 0);
}

#[test]
#[should_panic(expected: 'REFUND_NOT_AUTHORIZED')]
fn pool_cannot_redirect_refund_to_another_note() {
    let (escrow, _) = setup(1000);
    authorize(escrow, 0x777);
    start_cheat_caller_address(escrow.contract_address, addr(0x100));
    escrow.privacy_invoke(EscrowOperation::Refund(0x888), 0xabc, addr(0), 0, addr(0), addr(0), 0, false);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn non_pool_cannot_consume_authorization() {
    let (escrow, _) = setup(1000);
    authorize(escrow, 0x777);
    escrow.privacy_invoke(EscrowOperation::Refund(0x777), 0xabc, addr(0), 0, addr(0), addr(0), 0, false);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn refund_cannot_be_repeated() {
    let (escrow, _) = setup(1000);
    authorize(escrow, 0x777);
    start_cheat_caller_address(escrow.contract_address, addr(0x100));
    escrow.privacy_invoke(EscrowOperation::Refund(0x777), 0xabc, addr(0), 0, addr(0), addr(0), 0, false);
    escrow.privacy_invoke(EscrowOperation::Refund(0x777), 0xabc, addr(0), 0, addr(0), addr(0), 0, false);
}

#[test]
#[should_panic(expected: 'EXPIRED')]
fn claim_is_refused_at_the_exact_expiry_boundary() {
    let (escrow, _) = setup(1000);
    start_cheat_block_timestamp(escrow.contract_address, 1000);
    start_cheat_caller_address(escrow.contract_address, addr(0x200));
    escrow.claim(0xabc, addr(0x999));
}

#[test]
fn failed_transfer_preserves_entry_and_obligations() {
    let (escrow, token) = setup(1000);
    token.set_failures(true, false);
    start_cheat_block_timestamp(escrow.contract_address, 999);
    start_cheat_caller_address(escrow.contract_address, addr(0x200));
    assert(!harness().try_claim(escrow.contract_address), 'must fail');
    assert(!escrow.get_entry(0xabc).claimed, 'rollback entry');
    assert(escrow.escrowed_total(token.contract_address) == 100, 'rollback total');
}

#[test]
fn failed_approval_preserves_refund_authorization_and_funds() {
    let (escrow, token) = setup(1000);
    authorize(escrow, 0x777);
    token.set_failures(false, true);
    start_cheat_caller_address(escrow.contract_address, addr(0x100));
    assert(!harness().try_refund(escrow.contract_address), 'must fail');
    assert(!escrow.get_entry(0xabc).claimed, 'rollback entry');
    assert(escrow.refund_note(0xabc) == 0x777, 'rollback authorization');
    assert(escrow.escrowed_total(token.contract_address) == 100, 'rollback total');
}
