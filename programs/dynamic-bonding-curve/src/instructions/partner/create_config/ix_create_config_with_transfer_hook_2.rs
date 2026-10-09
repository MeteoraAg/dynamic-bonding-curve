use anchor_lang::prelude::*;

#[allow(deprecated)]
use crate::event::EvtCreateConfigV2WithTransferHook;
use crate::{
    event::EvtCreateConfig3WithTransferHook,
    state::TokenType,
    token::{get_mint_score, MintScore},
    PoolError,
};

use super::{
    process_create_config, ConfigParameters, CreateConfigWithTransferHookCtx, TransferFeeParameters,
};

pub fn handle_create_config_with_transfer_hook_2<'info>(
    ctx: Context<'info, CreateConfigWithTransferHookCtx<'info>>,
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
        true,
        ctx.accounts.fee_claimer.key,
    )?;
    if let Some(transfer_fee) = transfer_fee_parameters {
        transfer_fee.validate(config_parameters.token_type, ctx.accounts.fee_claimer.key)?;
    }

    let token_type = TokenType::try_from(config_parameters.token_type)
        .map_err(|_| PoolError::InvalidTokenType)?;
    require!(
        token_type == TokenType::Token2022,
        PoolError::InvalidTokenType
    );

    ctx.accounts.validate_transfer_hook_program()?;

    let mut config = ctx.accounts.config.load_init()?;
    process_create_config(
        &mut config,
        &config_parameters,
        transfer_fee_parameters,
        &ctx.accounts.quote_mint,
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
    )?;
    config.transfer_hook_program = ctx.accounts.transfer_hook_program.key();

    #[allow(deprecated)]
    {
        emit_cpi!(EvtCreateConfigV2WithTransferHook {
            config: ctx.accounts.config.key(),
            fee_claimer: ctx.accounts.fee_claimer.key(),
            quote_mint: ctx.accounts.quote_mint.key(),
            leftover_receiver: ctx.accounts.leftover_receiver.key(),
            transfer_hook_program: ctx.accounts.transfer_hook_program.key(),
            config_parameters: config_parameters.clone(),
        });
    }

    emit_cpi!(EvtCreateConfig3WithTransferHook {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        transfer_hook_program: ctx.accounts.transfer_hook_program.key(),
        config_parameters,
        transfer_fee_parameters,
    });

    Ok(())
}
