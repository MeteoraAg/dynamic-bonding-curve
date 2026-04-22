use anchor_lang::prelude::*;
use anchor_spl::{token, token_2022, token_interface::Mint};

#[allow(deprecated)]
use crate::event::EvtCreateConfigV2WithTransferHook;
use crate::{
    state::{ConfigWithTransferHook, TokenType},
    PoolError,
};

use super::{process_create_config, ConfigParameters};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateConfigWithTransferHookCtx<'info> {
    #[account(
        init,
        signer,
        payer = payer,
        space = 8 + ConfigWithTransferHook::INIT_SPACE
    )]
    pub config: AccountLoader<'info, ConfigWithTransferHook>,

    /// CHECK: fee_claimer
    pub fee_claimer: UncheckedAccount<'info>,
    /// CHECK: owner extra base token in case token is fixed supply
    pub leftover_receiver: UncheckedAccount<'info>,
    /// quote mint
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: transfer hook program
    #[account(executable)]
    pub transfer_hook_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_config_with_transfer_hook(
    ctx: Context<CreateConfigWithTransferHookCtx>,
    config_parameters: ConfigParameters,
) -> Result<()> {
    config_parameters.validate(
        &ctx.accounts.quote_mint,
        Clock::get()?.unix_timestamp as u64,
    )?;

    let token_type = TokenType::try_from(config_parameters.token_type)
        .map_err(|_| PoolError::InvalidTokenType)?;
    require!(
        token_type == TokenType::Token2022,
        PoolError::InvalidTokenType
    );

    let transfer_hook_program = &ctx.accounts.transfer_hook_program;
    // to be safe we disallow programs involved in the transfer chain (DBC, spl token, token 2022)
    require!(
        transfer_hook_program.key().ne(&crate::ID)
            && transfer_hook_program.key().ne(&token::ID)
            && transfer_hook_program.key().ne(&token_2022::ID),
        PoolError::InvalidTransferHookProgram
    );

    let mut config = ctx.accounts.config.load_init()?;
    process_create_config(
        &mut config,
        &config_parameters,
        &ctx.accounts.quote_mint,
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
    )?;
    config.transfer_hook_program = ctx.accounts.transfer_hook_program.key();

    emit_cpi!(EvtCreateConfigV2WithTransferHook {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        transfer_hook_program: ctx.accounts.transfer_hook_program.key(),
        config_parameters,
    });

    Ok(())
}
