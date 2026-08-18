/// Domain-separated Poseidon commitment for a MorokPay invoice.
///
/// `commitment = poseidon([TAG, merchant_secret, invoice_seq])`
pub const INVOICE_TAG: felt252 = 'MOROK_INVOICE:V1';

pub fn compute_commitment(merchant_secret: felt252, invoice_seq: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([INVOICE_TAG, merchant_secret, invoice_seq].span())
}
