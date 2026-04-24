use std::cell::{Ref, RefMut};

use anchor_lang::prelude::*;
use bytemuck::from_bytes;
use bytemuck::from_bytes_mut;

use crate::state::{ConfigWithTransferHook, PoolConfig};
use crate::PoolError;

pub struct ConfigAccountLoader<'a, 'info> {
    account_info: &'a AccountInfo<'info>,
}

impl<'a, 'info> ConfigAccountLoader<'a, 'info> {
    pub fn try_from(account_info: &'a AccountInfo<'info>) -> Result<Self> {
        require!(
            account_info.owner == &crate::ID,
            PoolError::InvalidConfigAccount
        );

        let data = account_info.try_borrow_data()?;
        let disc = &data[..8];
        let is_transfer_hook = disc == ConfigWithTransferHook::DISCRIMINATOR;

        if is_transfer_hook {
            require!(
                data.len() == 8 + std::mem::size_of::<ConfigWithTransferHook>(),
                PoolError::InvalidConfigAccount
            );
        } else {
            require!(
                disc == PoolConfig::DISCRIMINATOR,
                PoolError::InvalidConfigAccount
            );
            require!(
                data.len() == 8 + std::mem::size_of::<PoolConfig>(),
                PoolError::InvalidConfigAccount
            );
        }

        Ok(Self { account_info })
    }

    pub fn load(&self) -> Result<Ref<'_, PoolConfig>> {
        let data = self.account_info.try_borrow_data()?;
        Ok(Ref::map(data, |d| {
            let end = 8 + std::mem::size_of::<PoolConfig>();
            from_bytes(&d[8..end])
        }))
    }

    pub fn load_mut(&self) -> Result<RefMut<'_, PoolConfig>> {
        let data = self.account_info.try_borrow_mut_data()?;
        Ok(RefMut::map(data, |d| {
            let end = 8 + std::mem::size_of::<PoolConfig>();
            from_bytes_mut(&mut d[8..end])
        }))
    }

    pub fn key(&self) -> Pubkey {
        *self.account_info.key
    }
}
