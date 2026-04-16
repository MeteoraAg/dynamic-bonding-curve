use anchor_lang::prelude::*;

use crate::PoolError;

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AccountsType {
    TransferHookBase,
    TransferHookBaseReferral,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Default)]
pub struct TransferHookAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

impl TransferHookAccountsInfo {
    pub fn has_accounts(&self) -> bool {
        self.slices.iter().any(|s| s.length > 0)
    }
}

#[derive(Debug, Default)]
pub struct ParsedRemainingAccounts<'a, 'info> {
    pub transfer_hook_base: Option<&'a [AccountInfo<'info>]>,
    pub transfer_hook_base_referral: Option<&'a [AccountInfo<'info>]>,
}

pub fn parse_transfer_hook_accounts<'a, 'info>(
    remaining_accounts: &mut &'a [AccountInfo<'info>],
    remaining_accounts_slice: &[RemainingAccountsSlice],
) -> Result<ParsedRemainingAccounts<'a, 'info>> {
    let mut parsed_transfer_hook_accounts = ParsedRemainingAccounts::default();

    for slice in remaining_accounts_slice {
        if slice.length == 0 {
            continue;
        }

        let length = slice.length as usize;
        require!(
            remaining_accounts.len() >= length,
            PoolError::InvalidRemainingAccountsLength
        );

        let accounts = &remaining_accounts[..length];
        *remaining_accounts = &remaining_accounts[length..];

        match slice.accounts_type {
            AccountsType::TransferHookBase => {
                require!(
                    parsed_transfer_hook_accounts.transfer_hook_base.is_none(),
                    PoolError::DuplicatedRemainingAccountTypes
                );
                parsed_transfer_hook_accounts.transfer_hook_base = Some(accounts);
            }
            AccountsType::TransferHookBaseReferral => {
                require!(
                    parsed_transfer_hook_accounts
                        .transfer_hook_base_referral
                        .is_none(),
                    PoolError::DuplicatedRemainingAccountTypes
                );
                parsed_transfer_hook_accounts.transfer_hook_base_referral = Some(accounts);
            }
        }
    }

    Ok(parsed_transfer_hook_accounts)
}
