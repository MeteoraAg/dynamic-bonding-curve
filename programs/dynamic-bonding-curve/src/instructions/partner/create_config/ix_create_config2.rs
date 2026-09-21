use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    event::EvtCreateConfig3,
    state::{MigrationFeeOption, PoolConfig},
    token::has_transfer_fee_or_config_authority,
    PoolError,
};

use super::{process_create_config, ConfigParameters, TransferFeeParameters};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateConfig2Ctx<'info> {
    #[account(
        init,
        signer,
        payer = payer,
        space = 8 + PoolConfig::INIT_SPACE
    )]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: fee_claimer
    pub fee_claimer: UncheckedAccount<'info>,
    /// CHECK: owner extra base token in case token is fixed supply
    pub leftover_receiver: UncheckedAccount<'info>,
    /// quote mint
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_config2<'info>(
    ctx: Context<'info, CreateConfig2Ctx<'info>>,
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
            config_parameters.token_supply.is_some(),
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
