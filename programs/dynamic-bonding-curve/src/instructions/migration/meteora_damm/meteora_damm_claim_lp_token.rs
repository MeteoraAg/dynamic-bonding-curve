use std::u64;

use crate::{
    const_pda,
    state::{MigrationProgress, VirtualPool},
    *,
};
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct MigrateMeteoraDammClaimLpTokenCtx<'info> {
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    /// migration metadata
    #[account(mut, has_one = lp_mint, has_one = virtual_pool)]
    pub migration_metadata: AccountLoader<'info, MeteoraDammMigrationMetadata>,

    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: AccountInfo<'info>,

    /// CHECK: lp_mint
    pub lp_mint: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        mut,
        associated_token::mint = migration_metadata.load()?.lp_mint,
        associated_token::authority = pool_authority.key()
    )]
    pub source_token: Box<Account<'info, TokenAccount>>,

    /// CHECK: destination token account
    #[account(
        mut,
        associated_token::mint = migration_metadata.load()?.lp_mint,
        associated_token::authority = owner.key()
    )]
    pub destination_token: Box<Account<'info, TokenAccount>>,

    /// CHECK: owner of lp token, must be creator or partner
    pub owner: UncheckedAccount<'info>,

    /// CHECK: signer
    pub sender: Signer<'info>,

    /// token_program
    pub token_program: Program<'info, Token>,
}

impl<'info> MigrateMeteoraDammClaimLpTokenCtx<'info> {
    fn transfer(&self, bump: u8, amount: u64) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);

        transfer(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                Transfer {
                    from: self.source_token.to_account_info(),
                    to: self.destination_token.to_account_info(),
                    authority: self.pool_authority.to_account_info(),
                },
                &[&pool_authority_seeds[..]],
            ),
            amount,
        )?;

        Ok(())
    }
}
pub fn handle_migrate_meteora_damm_claim_lp_token<'info>(
    ctx: Context<'_, '_, '_, 'info, MigrateMeteoraDammClaimLpTokenCtx<'info>>,
) -> Result<()> {
    let virtual_pool = ctx.accounts.virtual_pool.load()?;

    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::CreatedPool,
        PoolError::NotPermitToDoThisAction
    );

    let mut migration_metadata = ctx.accounts.migration_metadata.load_mut()?;

    let is_partner = ctx.accounts.owner.key() == migration_metadata.partner;
    let is_creator = ctx.accounts.owner.key() == virtual_pool.creator;

    let liquidity_token_to_claim = match (is_partner, is_creator) {
        (true, true) => migration_metadata.claim_as_self_partnered_creator()?,
        (true, false) => migration_metadata.claim_as_partner()?,
        (false, true) => migration_metadata.claim_as_creator()?,
        (false, false) => return Err(PoolError::InvalidOwnerAccount.into()),
    };

    ctx.accounts
        .transfer(const_pda::pool_authority::BUMP, liquidity_token_to_claim)
}
