#![allow(deprecated)]
use anchor_lang::prelude::*;

#[event_cpi]
#[deprecated]
#[derive(Accounts)]
pub struct MigrationDammV2CreateMetadataCtx<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub virtual_pool: UncheckedAccount<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub config: UncheckedAccount<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub migration_metadata: UncheckedAccount<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub payer: UncheckedAccount<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub system_program: UncheckedAccount<'info>,
}

pub fn handle_migration_damm_v2_create_metadata(
    _ctx: Context<MigrationDammV2CreateMetadataCtx>,
) -> Result<()> {
    Ok(())
}
