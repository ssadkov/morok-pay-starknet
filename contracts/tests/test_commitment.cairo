use morok_pay::commitment::{INVOICE_TAG, compute_commitment};

#[test]
fn different_sequences_differ() {
    let first = compute_commitment(11, 1);
    let second = compute_commitment(11, 2);
    assert(first != second, 'seq should change hash');
}

#[test]
fn different_secrets_differ() {
    let first = compute_commitment(11, 1);
    let second = compute_commitment(12, 1);
    assert(first != second, 'secret should change hash');
}

#[test]
fn tag_is_short_string() {
    assert(INVOICE_TAG == 'MOROK_INVOICE:V1', 'unexpected tag');
}

#[test]
fn matches_starknet_js_poseidon() {
    // hash.computePoseidonHashOnElements(['MOROK_INVOICE:V1', 11, 1])
    let expected: felt252 = 0x01e0357743602697d85e4f3e679ffb49752e6fd65fdef8579a1de9d0544f882f;
    assert(compute_commitment(11, 1) == expected, 'js poseidon mismatch');
}
