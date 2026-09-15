use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{event::EvtCreateConfig2, state::PoolConfig};

use super::{process_create_config, ConfigParameters2};

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
    config_parameters: ConfigParameters2,
) -> Result<()> {
    config_parameters.validate(
        &ctx.accounts.quote_mint,
        ctx.remaining_accounts.first(),
        Clock::get()?.unix_timestamp as u64,
        false,
    )?;

    let mut config = ctx.accounts.config.load_init()?;
    process_create_config(
        &mut config,
        &config_parameters,
        &ctx.accounts.quote_mint,
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
    )?;

    emit_cpi!(EvtCreateConfig2 {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters,
    });

    Ok(())
}
