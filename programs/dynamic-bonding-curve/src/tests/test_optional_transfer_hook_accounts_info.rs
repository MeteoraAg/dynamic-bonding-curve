use anchor_lang::{prelude::borsh, AnchorDeserialize};

use crate::{
    instruction::ClaimProtocolFee2,
    optional_transfer_hook_accounts_info::OptionalTransferHookAccountsInfo,
    remaining_accounts::{AccountsType, RemainingAccountsSlice, TransferHookAccountsInfo},
};

fn decode(data: &[u8]) -> ClaimProtocolFee2 {
    // anchor decodes instruction arguments with `deserialize`, which leaves trailing bytes unread
    ClaimProtocolFee2::deserialize(&mut &data[..]).unwrap()
}

#[test]
fn test_decode_without_transfer_hook_accounts_info() {
    // instruction data from a client built before the argument was added
    let data = 100u64.to_le_bytes();

    let ix = decode(&data);

    assert_eq!(ix.max_amount, 100);
    assert!(ix.transfer_hook_accounts_info.0.is_none());
}

#[test]
fn test_decode_with_transfer_hook_accounts_info() {
    let info = TransferHookAccountsInfo {
        slices: vec![RemainingAccountsSlice {
            accounts_type: AccountsType::TransferHookBase,
            length: 3,
        }],
    };
    let data = borsh::to_vec(&ClaimProtocolFee2 {
        max_amount: 100,
        transfer_hook_accounts_info: OptionalTransferHookAccountsInfo(Some(info)),
    })
    .unwrap();

    let ix = decode(&data);

    assert_eq!(ix.max_amount, 100);
    let slices = ix.transfer_hook_accounts_info.0.unwrap().slices;
    assert_eq!(slices.len(), 1);
    assert_eq!(slices[0].accounts_type, AccountsType::TransferHookBase);
    assert_eq!(slices[0].length, 3);
}

#[test]
fn test_decode_with_none_transfer_hook_accounts_info() {
    let data = borsh::to_vec(&ClaimProtocolFee2 {
        max_amount: 100,
        transfer_hook_accounts_info: OptionalTransferHookAccountsInfo(None),
    })
    .unwrap();
    assert_eq!(data.len(), 9);

    let ix = decode(&data);

    assert_eq!(ix.max_amount, 100);
    assert!(ix.transfer_hook_accounts_info.0.is_none());
}

#[test]
fn test_decode_rejects_invalid_option_flag() {
    let mut data = 100u64.to_le_bytes().to_vec();
    data.push(2);

    assert!(ClaimProtocolFee2::deserialize(&mut &data[..]).is_err());
}
