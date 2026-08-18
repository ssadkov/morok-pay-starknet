use morok_pay::echo_helper::{EchoHelper, IEchoHelperDispatcher, IEchoHelperDispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn deploy() -> IEchoHelperDispatcher {
    let contract = declare("EchoHelper").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    IEchoHelperDispatcher { contract_address: address }
}

#[test]
fn emit_caller_and_credit_nothing() {
    let helper = deploy();
    let caller: ContractAddress = 0x123.try_into().unwrap();
    let mut spy = spy_events();

    start_cheat_caller_address(helper.contract_address, caller);
    let deposits = helper.privacy_invoke();
    stop_cheat_caller_address(helper.contract_address);

    assert(deposits.len() == 0, 'expected empty span');
    spy
        .assert_emitted(
            @array![
                (
                    helper.contract_address,
                    EchoHelper::Event::Invoked(EchoHelper::Invoked { caller }),
                ),
            ],
        );
}
