use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[allow(deprecated)]
use crate::event::EvtCreateConfigV2;
use crate::{
    event::EvtCreateConfig3, state::PoolConfig, token::has_transfer_fee_or_config_authority,
    PoolError,
};

use super::{process_create_config, ConfigParameters, TransferFeeParameters};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateConfigCtx<'info> {
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
    /// for transfer fee case (create_config2) token is restricted to constant supply
    pub leftover_receiver: UncheckedAccount<'info>,
    /// quote mint
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_config<'info>(
    ctx: Context<'info, CreateConfigCtx<'info>>,
    config_parameters: ConfigParameters,
) -> Result<()> {
    config_parameters.validate(
        &ctx.accounts.quote_mint,
        ctx.remaining_accounts.first(),
        Clock::get()?.unix_timestamp as u64,
        false,
    )?;

    require!(
        !has_transfer_fee_or_config_authority(&ctx.accounts.quote_mint.to_account_info())?,
        PoolError::QuoteMintHasNonZeroTransferFee
    );

    let mut config = ctx.accounts.config.load_init()?;
    let transfer_fee_parameters = TransferFeeParameters::default();
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
