use std::cell::{Ref, RefMut};

use anchor_lang::prelude::*;
use bytemuck::from_bytes;
use bytemuck::from_bytes_mut;

use crate::state::{PoolState, TransferHookPool, VirtualPool};
use crate::PoolError;

pub struct PoolAccountLoader<'a, 'info> {
    account_info: &'a AccountInfo<'info>,
    is_transfer_hook: bool,
}

impl<'a, 'info> PoolAccountLoader<'a, 'info> {
    pub fn try_from(account_info: &'a AccountInfo<'info>) -> Result<Self> {
        require!(
            account_info.owner == &crate::ID,
            PoolError::InvalidPoolAccount
        );

        let data = account_info.try_borrow_data()?;
        let data_len = data.len();
        require!(
            data_len == 8 + std::mem::size_of::<PoolState>(),
            PoolError::InvalidPoolAccount
        );

        let disc = &data[..8];
        let is_transfer_hook = disc == TransferHookPool::DISCRIMINATOR;

        require!(
            disc == VirtualPool::DISCRIMINATOR || is_transfer_hook,
            PoolError::InvalidPoolAccount
        );

        Ok(Self {
            account_info,
            is_transfer_hook,
        })
    }

    pub fn load(&self) -> Result<Ref<'_, PoolState>> {
        let data = self.account_info.try_borrow_data()?;
        Ok(Ref::map(data, |d| {
            let end = 8 + std::mem::size_of::<PoolState>();
            from_bytes(&d[8..end])
        }))
    }

    pub fn load_mut(&self) -> Result<RefMut<'_, PoolState>> {
        let data = self.account_info.try_borrow_mut_data()?;
        Ok(RefMut::map(data, |d| {
            let end = 8 + std::mem::size_of::<PoolState>();
            from_bytes_mut(&mut d[8..end])
        }))
    }

    pub fn key(&self) -> Pubkey {
        *self.account_info.key
    }

    pub fn is_transfer_hook_pool(&self) -> bool {
        self.is_transfer_hook
    }
}
