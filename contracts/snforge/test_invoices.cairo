use morok_pay::invoices::{IMorokInvoicesDispatcher, IMorokInvoicesDispatcherTrait, MorokInvoices};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn deploy(pool: ContractAddress) -> IMorokInvoicesDispatcher {
    let contract = declare("MorokInvoices").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool.into()]).unwrap();
    IMorokInvoicesDispatcher { contract_address: address }
}

fn pool() -> ContractAddress {
    0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a.try_into().unwrap()
}

#[test]
fn stores_pool_from_constructor() {
    let invoices = deploy(pool());
    assert(invoices.privacy_contract() == pool(), 'pool mismatch');
}

#[test]
fn pool_call_emits_commitment_and_credits_nothing() {
    let invoices = deploy(pool());
    let commitment: felt252 = 0xabc;
    let mut spy = spy_events();

    start_cheat_caller_address(invoices.contract_address, pool());
    let deposits = invoices.privacy_invoke(commitment);
    stop_cheat_caller_address(invoices.contract_address);

    assert(deposits.len() == 0, 'expected empty span');
    spy
        .assert_emitted(
            @array![
                (
                    invoices.contract_address,
                    MorokInvoices::Event::InvoiceSettled(
                        MorokInvoices::InvoiceSettled { commitment },
                    ),
                ),
            ],
        );
}

#[test]
fn repeated_commitment_emits_again() {
    let invoices = deploy(pool());
    let commitment: felt252 = 0xabc;
    let mut spy = spy_events();

    start_cheat_caller_address(invoices.contract_address, pool());
    invoices.privacy_invoke(commitment);
    invoices.privacy_invoke(commitment);
    stop_cheat_caller_address(invoices.contract_address);

    spy
        .assert_emitted(
            @array![
                (
                    invoices.contract_address,
                    MorokInvoices::Event::InvoiceSettled(
                        MorokInvoices::InvoiceSettled { commitment },
                    ),
                ),
                (
                    invoices.contract_address,
                    MorokInvoices::Event::InvoiceSettled(
                        MorokInvoices::InvoiceSettled { commitment },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn outsider_cannot_emit() {
    let invoices = deploy(pool());
    invoices.privacy_invoke(0xabc);
}

#[test]
#[should_panic(expected: 'ZERO_COMMITMENT')]
fn zero_commitment_reverts() {
    let invoices = deploy(pool());
    start_cheat_caller_address(invoices.contract_address, pool());
    invoices.privacy_invoke(0);
}

#[test]
fn zero_pool_constructor_fails() {
    let contract = declare("MorokInvoices").unwrap().contract_class();
    let result = contract.deploy(@array![0]);
    assert(result.is_err(), 'zero pool should fail');
}
