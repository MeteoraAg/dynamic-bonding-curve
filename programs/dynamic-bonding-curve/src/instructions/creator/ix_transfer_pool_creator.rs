use anchor_lang::prelude::*;

use crate::{
    state::{MigrationOption, MigrationProgress, PoolConfig, VirtualPool},
    EvtUpdatePoolCreator, MeteoraDammMigrationMetadata, PoolError,
};

/// Accounts for transfer pool creator
#[event_cpi]
#[derive(Accounts)]
pub struct TransferPoolCreatorCtx<'info> {
    #[account(
        mut,
        has_one = config,
    )]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    pub config: AccountLoader<'info, PoolConfig>,

    pub creator: Signer<'info>,

    /// CHECK: new creator address, can be anything except old creator
    #[account(
        constraint = new_creator.key().ne(creator.key) @ PoolError::InvalidNewCreator,
    )]
    pub new_creator: UncheckedAccount<'info>,
}

pub fn handle_transfer_pool_creator<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, TransferPoolCreatorCtx>,
) -> Result<()> {
    let mut pool = ctx.accounts.virtual_pool.load_mut()?;

    let migration_progress = pool.get_migration_progress()?;
    let config = ctx.accounts.config.load()?;
    match migration_progress {
        MigrationProgress::PreBondingCurve => {
            // always work
        }
        MigrationProgress::CreatedPool => {
            let migration_option = MigrationOption::try_from(config.migration_option)
                .map_err(|_| PoolError::InvalidMigrationOption)?;
            if migration_option == MigrationOption::MeteoraDamm {
                // Can only transfer pool creator after LP claimed + locked
                let migration_metadata_account = ctx
                    .remaining_accounts
                    .get(0)
                    .ok_or_else(|| PoolError::InvalidAccount)?;
                let migration_metadata_loader: AccountLoader<'_, MeteoraDammMigrationMetadata> =
                    AccountLoader::try_from(migration_metadata_account)?;
                let migration_metadata = migration_metadata_loader.load()?;

                require!(
                    migration_metadata.virtual_pool == ctx.accounts.virtual_pool.key(),
                    PoolError::InvalidAccount
                );

                require!(
                    migration_metadata.partner_locked_lp == 0
                        || migration_metadata.is_partner_lp_locked(),
                    PoolError::NotPermitToDoThisAction
                );

                require!(
                    migration_metadata.creator_locked_lp == 0
                        || migration_metadata.is_creator_lp_locked(),
                    PoolError::NotPermitToDoThisAction
                );

                require!(
                    migration_metadata.creator_lp == 0 || migration_metadata.is_creator_claim_lp(),
                    PoolError::NotPermitToDoThisAction
                );
                require!(
                    migration_metadata.partner_lp == 0 || migration_metadata.is_partner_claim_lp(),
                    PoolError::NotPermitToDoThisAction
                );
            }
        }
        _ => return Err(PoolError::NotPermitToDoThisAction.into()),
    }

    pool.creator = ctx.accounts.new_creator.key();

    emit_cpi!(EvtUpdatePoolCreator {
        pool: ctx.accounts.virtual_pool.key(),
        creator: ctx.accounts.creator.key(),
        new_creator: ctx.accounts.new_creator.key(),
    });
    Ok(())
}
