use anchor_lang::prelude::*;

use crate::event::EvtCreateConfig3;
#[allow(deprecated)]
use crate::event::EvtCreateConfigV2;

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
