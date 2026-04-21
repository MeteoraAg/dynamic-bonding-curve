use anchor_lang::prelude::*;
use anchor_spl::{token_2022, token_interface::Mint};

#[allow(deprecated)]
use crate::event::{EvtCreateConfig, EvtCreateConfigV2WithTransferHook};
#[allow(deprecated)]
use crate::{
    state::{ConfigWithTransferHook, TokenType},
    CreateConfigResult, PoolError,
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
    /// CHECK: transfer hook program — validated in handler
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
    require!(
        transfer_hook_program.executable
            && transfer_hook_program.key().ne(&crate::ID)
            && transfer_hook_program.key().ne(&token_2022::ID),
        PoolError::InvalidTransferHookProgram
    );

    let mut config = ctx.accounts.config.load_init()?;
    let CreateConfigResult {
        swap_base_amount,
        included_protocol_fee_migration_base_amount,
        fixed_token_supply_flag,
        pre_migration_token_supply,
        post_migration_token_supply,
    } = process_create_config(
        &mut config,
        &config_parameters,
        &ctx.accounts.quote_mint,
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
    )?;
    config.transfer_hook_program = ctx.accounts.transfer_hook_program.key();

    #[allow(deprecated)]
    {
        emit_cpi!(EvtCreateConfig {
            config: ctx.accounts.config.key(),
            fee_claimer: ctx.accounts.fee_claimer.key(),
            quote_mint: ctx.accounts.quote_mint.key(),
            owner: ctx.accounts.leftover_receiver.key(),
            pool_fees: config_parameters.pool_fees.clone(),
            collect_fee_mode: config_parameters.collect_fee_mode,
            migration_option: config_parameters.migration_option,
            activation_type: config_parameters.activation_type,
            token_decimal: config_parameters.token_decimal,
            token_type: config_parameters.token_type,
            partner_permanent_locked_liquidity_percentage: config_parameters
                .partner_permanent_locked_liquidity_percentage,
            partner_liquidity_percentage: config_parameters.partner_liquidity_percentage,
            creator_permanent_locked_liquidity_percentage: config_parameters
                .creator_permanent_locked_liquidity_percentage,
            creator_liquidity_percentage: config_parameters.creator_liquidity_percentage,
            swap_base_amount,
            migration_quote_threshold: config_parameters.migration_quote_threshold,
            migration_base_amount: included_protocol_fee_migration_base_amount,
            sqrt_start_price: config_parameters.sqrt_start_price,
            fixed_token_supply_flag,
            pre_migration_token_supply,
            post_migration_token_supply,
            locked_vesting: config_parameters.locked_vesting,
            migration_fee_option: config_parameters.migration_fee_option,
            curve: config_parameters.curve.clone(),
        });
    }

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
