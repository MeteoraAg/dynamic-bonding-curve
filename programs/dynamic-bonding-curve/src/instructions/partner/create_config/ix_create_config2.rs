use anchor_lang::prelude::*;

#[allow(deprecated)]
use crate::event::EvtCreateConfigV2;
use crate::{
    event::EvtCreateConfig3, migration_handler::MigratedCollectFeeMode, state::MigrationFeeOption,
    token::has_transfer_fee_or_config_authority, PoolError,
};

use super::{process_create_config, ConfigParameters, CreateConfigCtx, TransferFeeParameters};

pub fn handle_create_config2<'info>(
    ctx: Context<'info, CreateConfigCtx<'info>>,
    config_parameters: ConfigParameters,
    transfer_fee_parameters: Option<TransferFeeParameters>,
) -> Result<()> {
    let transfer_fee_parameters = transfer_fee_parameters.unwrap_or_default();

    config_parameters.validate(
        &ctx.accounts.quote_mint,
        ctx.remaining_accounts.first(),
        Clock::get()?.unix_timestamp as u64,
        false,
    )?;
    transfer_fee_parameters.validate(config_parameters.token_type)?;

    let has_transfer_fee = transfer_fee_parameters.has_transfer_fee()
        || has_transfer_fee_or_config_authority(&ctx.accounts.quote_mint.to_account_info())?;

    if has_transfer_fee {
        // require certain config parameters when config has transfer fee

        require!(
            config_parameters.is_constant_token_supply(),
            PoolError::InvalidTokenSupply
        );
        require!(
            !config_parameters.locked_vesting.has_vesting(),
            PoolError::InvalidVestingParameters
        );
        let migration_fee_option =
            MigrationFeeOption::try_from(config_parameters.migration_fee_option)
                .map_err(|_| PoolError::InvalidMigrationFeeOption)?;
        require!(
            migration_fee_option == MigrationFeeOption::Customizable,
            PoolError::InvalidMigrationFeeOption
        );
        let migrated_collect_fee_mode =
            MigratedCollectFeeMode::try_from(config_parameters.migrated_pool_fee.collect_fee_mode)
                .map_err(|_| PoolError::InvalidCollectFeeMode)?;
        require!(
            migrated_collect_fee_mode == MigratedCollectFeeMode::Compounding,
            PoolError::InvalidMigratedPoolFee
        );
    }

    let mut config = ctx.accounts.config.load_init()?;
    process_create_config(
        &mut config,
        &config_parameters,
        &transfer_fee_parameters,
        &ctx.accounts.quote_mint,
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
    )?;

    #[allow(deprecated)]
    {
        emit_cpi!(EvtCreateConfigV2 {
            config: ctx.accounts.config.key(),
            fee_claimer: ctx.accounts.fee_claimer.key(),
            quote_mint: ctx.accounts.quote_mint.key(),
            leftover_receiver: ctx.accounts.leftover_receiver.key(),
            config_parameters: config_parameters.clone(),
        });
    }

    emit_cpi!(EvtCreateConfig3 {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters,
        transfer_fee_parameters,
    });

    Ok(())
}
