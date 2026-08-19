use morok_pay::escrow::{
    EscrowOperation, IMorokEscrowDispatcher, IMorokEscrowDispatcherTrait, MorokEscrow,
    compute_escrow_commitment,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn deploy_token() -> ContractAddress {
    let contract = declare("MockErc20").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    address
}

fn deploy_escrow(pool: ContractAddress) -> IMorokEscrowDispatcher {
    let contract = declare("MorokEscrow").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool.into()]).unwrap();
    IMorokEscrowDispatcher { contract_address: address }
}

fn pool() -> ContractAddress {
    0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91.try_into().unwrap()
}

fn outsider() -> ContractAddress {
    0x111.try_into().unwrap()
}

#[starknet::interface]
trait IMockErc20<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
}

#[starknet::contract]
mod MockErc20 {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockErc20Impl of super::IMockErc20<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let caller = starknet::get_caller_address();
            self.allowances.write((caller, spender), amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
    }
}

fn deposit(
    escrow: IMorokEscrowDispatcher,
    commitment: felt252,
    token: ContractAddress,
    amount: u128,
) {
    start_cheat_caller_address(escrow.contract_address, pool());
    let deposits = escrow
        .privacy_invoke(EscrowOperation::Deposit, commitment, token, amount, 0, 0);
    stop_cheat_caller_address(escrow.contract_address);
    assert(deposits.len() == 0, 'deposit credits nothing');
}

#[test]
fn stores_pool_from_constructor() {
    let escrow = deploy_escrow(pool());
    assert(escrow.privacy_contract() == pool(), 'pool mismatch');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn outsider_cannot_deposit() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    escrow.privacy_invoke(EscrowOperation::Deposit, 0xabc, token, 1, 0, 0);
}

#[test]
#[should_panic(expected: 'NOT_FUNDED')]
fn unfunded_deposit_reverts() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow.privacy_invoke(EscrowOperation::Deposit, 0xabc, token, 1, 0, 0);
}

#[test]
fn funded_deposit_records_the_entry() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    let token_dispatcher = IMockErc20Dispatcher { contract_address: token };
    token_dispatcher.mint(escrow.contract_address, 500_000);
    let mut spy = spy_events();

    deposit(escrow, 0xabc, token, 500_000);

    let entry = escrow.get_entry(0xabc);
    assert(entry.token == token, 'token mismatch');
    assert(entry.amount == 500_000, 'amount mismatch');
    assert(!entry.claimed, 'should be unclaimed');
    assert(escrow.escrowed_total(token) == 500_000, 'total mismatch');
    spy
        .assert_emitted(
            @array![
                (
                    escrow.contract_address,
                    MorokEscrow::Event::Escrowed(
                        MorokEscrow::Escrowed { commitment: 0xabc, token, amount: 500_000 },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn duplicate_commitment_reverts() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    IMockErc20Dispatcher { contract_address: token }.mint(escrow.contract_address, 2);
    deposit(escrow, 0xabc, token, 1);
    deposit(escrow, 0xabc, token, 1);
}

#[test]
fn claim_returns_the_open_note_and_cannot_repeat() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    IMockErc20Dispatcher { contract_address: token }.mint(escrow.contract_address, 500_000);
    let secret: felt252 = 11;
    let commitment = compute_escrow_commitment(secret);
    deposit(escrow, commitment, token, 500_000);

    start_cheat_caller_address(escrow.contract_address, pool());
    let deposits = escrow
        .privacy_invoke(EscrowOperation::Claim, 0, 0.try_into().unwrap(), 0, secret, 0x42);
    stop_cheat_caller_address(escrow.contract_address);

    assert(deposits.len() == 1, 'expected one deposit');
    let first = *deposits.at(0);
    assert(first.note_id == 0x42, 'note mismatch');
    assert(first.token == token, 'token mismatch');
    assert(first.amount == 500_000, 'amount mismatch');
    assert(escrow.get_entry(commitment).claimed, 'should be claimed');
    assert(escrow.escrowed_total(token) == 0, 'total should clear');
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn second_claim_reverts() {
    let escrow = deploy_escrow(pool());
    let token = deploy_token();
    IMockErc20Dispatcher { contract_address: token }.mint(escrow.contract_address, 1);
    let secret: felt252 = 11;
    deposit(escrow, compute_escrow_commitment(secret), token, 1);
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow.privacy_invoke(EscrowOperation::Claim, 0, 0.try_into().unwrap(), 0, secret, 1);
    escrow.privacy_invoke(EscrowOperation::Claim, 0, 0.try_into().unwrap(), 0, secret, 1);
}

#[test]
fn zero_pool_constructor_fails() {
    let contract = declare("MorokEscrow").unwrap().contract_class();
    let result = contract.deploy(@array![0]);
    assert(result.is_err(), 'zero pool should fail');
}
