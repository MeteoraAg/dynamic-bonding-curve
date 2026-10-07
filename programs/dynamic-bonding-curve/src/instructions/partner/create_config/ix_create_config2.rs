use anchor_lang::prelude::*;

#[allow(deprecated)]
use crate::event::EvtCreateConfigV2;
use crate::{
    event::EvtCreateConfig3,
    token::{get_mint_score, MintScore},
    PoolError,
};

use super::{process_create_config, ConfigParameters, CreateConfigCtx, TransferFeeParameters};

pub fn handle_create_config2<'info>(
    ctx: Context<'info, CreateConfigCtx<'info>>,
    config_parameters: ConfigParameters,
    transfer_fee_parameters: Option<TransferFeeParameters>,
) -> Result<()> {
    let mint_score = get_mint_score(&ctx.accounts.quote_mint, ctx.remaining_accounts.first())?;
    require!(
        mint_score >= MintScore::PermissionedWithTransferFee,
        PoolError::InvalidQuoteMint
    );

    config_parameters.validate(
        Clock::get()?.unix_timestamp as u64,
        false,
        ctx.accounts.fee_claimer.key,
    )?;
    if let Some(transfer_fee) = transfer_fee_parameters {
        transfer_fee.validate(config_parameters.token_type, ctx.accounts.fee_claimer.key)?;
    }

    let mut config = ctx.accounts.config.load_init()?;
    process_create_config(
        &mut config,
        &config_parameters,
        transfer_fee_parameters,
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
