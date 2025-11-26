use crate::{state::*, *};
use anchor_lang::system_program::{transfer, Transfer};

/// Accounts for partner withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPartnerPoolCreationFeeCtx<'info> {
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    #[account(has_one = fee_claimer)]
    pub config: AccountLoader<'info, PoolConfig>,

    pub fee_claimer: Signer<'info>,

    /// CHECK: fee receiver
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_partner_pool_creation_fee(
    ctx: Context<ClaimPartnerPoolCreationFeeCtx>,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let partner_pool_creation_fee = pool.get_partner_pool_creation_fee()?;
    if partner_pool_creation_fee > 0 {
        pool.update_partner_pool_creation_fee_claimed();

        let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_authority.to_account_info(),
                    to: ctx.accounts.fee_receiver.to_account_info(),
                },
                &[&seeds[..]],
            ),
            partner_pool_creation_fee,
        )?;

        emit_cpi!(EvtClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.fee_receiver.key(),
            creation_fee: partner_pool_creation_fee,
        });
    }

    Ok(())
}
