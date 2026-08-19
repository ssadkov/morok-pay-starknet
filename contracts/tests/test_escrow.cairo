use morok_pay::escrow::{ESCROW_TAG, compute_escrow_commitment};

#[test]
fn different_secrets_differ() {
    let first = compute_escrow_commitment(11);
    let second = compute_escrow_commitment(12);
    assert(first != second, 'secret should change hash');
}

#[test]
fn tag_is_short_string() {
    assert(ESCROW_TAG == 'MOROK_ESCROW:V1', 'unexpected tag');
}

#[test]
fn matches_starknet_js_poseidon() {
    // hash.computePoseidonHashOnElements(['MOROK_ESCROW:V1', 11])
    let expected: felt252 =
        0x0251f0242a4e3747bcbb19fd743f50ad614497e1c6223d97f0e21e5edc2cd9ce;
    assert(compute_escrow_commitment(11) == expected, 'js poseidon mismatch');
}
