use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[allow(deprecated)]
use crate::event::{EvtCreateConfig, EvtCreateConfigV2};
use crate::{state::PoolConfig, CreateConfigResult};

use super::{process_create_config, ConfigParameters};

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
    pub leftover_receiver: UncheckedAccount<'info>,
    /// quote mint
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_config(
    ctx: Context<CreateConfigCtx>,
    config_parameters: ConfigParameters,
) -> Result<()> {
    config_parameters.validate(
        &ctx.accounts.quote_mint,
        Clock::get()?.unix_timestamp as u64,
    )?;

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

    emit_cpi!(EvtCreateConfigV2 {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters,
    });

    Ok(())
}
