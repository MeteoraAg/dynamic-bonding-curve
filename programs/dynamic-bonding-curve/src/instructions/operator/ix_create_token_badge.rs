use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::seeds::TOKEN_BADGE_PREFIX,
    event::EvtCreateTokenBadge,
    state::{Operator, TokenBadge},
    token::{get_mint_score, MintScore},
    PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateTokenBadgeCtx<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            TOKEN_BADGE_PREFIX.as_ref(),
            token_mint.key().as_ref()
        ],
        bump,
        space = 8 + TokenBadge::INIT_SPACE
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// a token badge relies on trust in the management of the mint
pub fn handle_create_token_badge(ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
    let mint_score = get_mint_score(&ctx.accounts.token_mint, None)?;
    require!(
        mint_score == MintScore::Unsupported,
        PoolError::CannotCreateTokenBadgeOnSupportedMint
    );

    let mut token_badge = ctx.accounts.token_badge.load_init()?;
    token_badge.initialize(ctx.accounts.token_mint.key())?;

    emit_cpi!(EvtCreateTokenBadge {
        token_mint: ctx.accounts.token_mint.key(),
    });

    Ok(())
}
