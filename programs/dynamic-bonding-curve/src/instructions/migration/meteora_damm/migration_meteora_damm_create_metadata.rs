use anchor_lang::prelude::*;

use crate::state::{MigrationOption, PoolConfig};
use crate::PoolError;
use crate::{
    constants::seeds::METEORA_METADATA_PREFIX, event::EvtCreateMeteoraMigrationMetadata,
    state::VirtualPool,
};

use super::MeteoraDammMigrationMetadata;

#[event_cpi]
#[derive(Accounts)]
pub struct MigrationMeteoraDammCreateMetadataCtx<'info> {
    #[account(has_one=config)]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    pub config: AccountLoader<'info, PoolConfig>,

    #[account(
        init,
        payer = payer,
        seeds = [
            METEORA_METADATA_PREFIX.as_ref(),
            virtual_pool.key().as_ref(),
        ],
        bump,
        space = 8 + MeteoraDammMigrationMetadata::INIT_SPACE
    )]
    pub migration_metadata: AccountLoader<'info, MeteoraDammMigrationMetadata>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_migration_meteora_damm_create_metadata(
    ctx: Context<MigrationMeteoraDammCreateMetadataCtx>,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let migration_option = MigrationOption::try_from(config.migration_option)
        .map_err(|_| PoolError::InvalidMigrationOption)?;
    require!(
        migration_option == MigrationOption::MeteoraDamm,
        PoolError::InvalidMigrationOption
    );
    let mut migration_metadata = ctx.accounts.migration_metadata.load_init()?;
    migration_metadata.virtual_pool = ctx.accounts.virtual_pool.key();
    migration_metadata.partner = config.fee_claimer;

    emit_cpi!(EvtCreateMeteoraMigrationMetadata {
        virtual_pool: ctx.accounts.virtual_pool.key(),
    });

    Ok(())
}
