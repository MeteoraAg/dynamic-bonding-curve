use anchor_lang::system_program::{transfer, Transfer};

use crate::{
    constants::fee::TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE, state::*,
    EvtClaimPoolCreationFee, *,
};

/// Accounts for withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolPoolCreationFeeCtx<'info> {
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// Claim fee operator
    #[account(has_one = operator)]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Operator
    pub operator: Signer<'info>,

    /// CHECK: treasury
    #[account(
        mut,
        address = treasury::ID
    )]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_protocol_pool_creation_fee(
    ctx: Context<ClaimProtocolPoolCreationFeeCtx>,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    if pool.has_creation_fee() && !pool.protocol_pool_creation_fee_claimed() {
        pool.update_protocol_pool_creation_fee_claimed();

        let claimed_fee;
        if pool.creation_fee > 0 {
            let protocol_pool_creation_fee = pool.get_protocol_pool_creation_fee()?;
            let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
            // Transfer the creation fee from pool authority to the treasury
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool_authority.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                    &[&seeds[..]],
                ),
                protocol_pool_creation_fee,
            )?;

            claimed_fee = protocol_pool_creation_fee
        } else {
            // Transfer the creation fee from pool to the treasury
            ctx.accounts
                .pool
                .sub_lamports(TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE)?;
            ctx.accounts
                .treasury
                .add_lamports(TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE)?;

            claimed_fee = TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE
        }

        emit_cpi!(EvtClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.treasury.key(),
            creation_fee: claimed_fee,
        });
    }

    Ok(())
}
