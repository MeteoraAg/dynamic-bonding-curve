use std::u64;

use crate::{
    const_pda,
    cpi_checker::cpi_with_account_lamport_and_owner_checking,
    state::{MigrationProgress, VirtualPool},
    *,
};
use anchor_spl::token::{Token, TokenAccount};
use dynamic_amm::accounts::LockEscrow;

/// create lock escrow must be before that transaction
#[derive(Accounts)]
pub struct MigrateMeteoraDammLockLpTokenCtx<'info> {
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    /// migration_metadata
    #[account(mut, has_one = lp_mint, has_one = virtual_pool)]
    pub migration_metadata: AccountLoader<'info, MeteoraDammMigrationMetadata>,

    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: AccountInfo<'info>,

    /// CHECK: pool
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: lp_mint
    pub lp_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one=pool,
        has_one=owner,
    )]
    pub lock_escrow: Box<Account<'info, LockEscrow>>,

    /// CHECK: owner
    pub owner: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        mut,
        associated_token::mint = migration_metadata.load()?.lp_mint,
        associated_token::authority = pool_authority.key()
    )]
    pub source_tokens: Box<Account<'info, TokenAccount>>,

    /// CHECK:
    #[account(mut)]
    pub escrow_vault: UncheckedAccount<'info>,

    /// CHECK: amm_program
    #[account(address = dynamic_amm::ID)]
    pub amm_program: UncheckedAccount<'info>,

    /// CHECK: Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
    pub a_vault: UncheckedAccount<'info>,
    /// CHECK: Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
    pub b_vault: UncheckedAccount<'info>,
    /// CHECK: LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
    pub a_vault_lp: UncheckedAccount<'info>,
    /// CHECK: LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
    pub b_vault_lp: UncheckedAccount<'info>,
    /// CHECK: LP token mint of vault a
    pub a_vault_lp_mint: UncheckedAccount<'info>,
    /// CHECK: LP token mint of vault b
    pub b_vault_lp_mint: UncheckedAccount<'info>,

    /// token_program
    pub token_program: Program<'info, Token>,
}

impl<'info> MigrateMeteoraDammLockLpTokenCtx<'info> {
    fn lock(&self, bump: u8, max_amount: u64) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);

        cpi_with_account_lamport_and_owner_checking(
            || {
                dynamic_amm::cpi::lock(
                    CpiContext::new_with_signer(
                        self.amm_program.to_account_info(),
                        dynamic_amm::cpi::accounts::Lock {
                            pool: self.pool.to_account_info(),
                            lp_mint: self.lp_mint.to_account_info(),
                            a_vault: self.a_vault.to_account_info(),
                            b_vault: self.b_vault.to_account_info(),
                            a_vault_lp_mint: self.a_vault_lp_mint.to_account_info(),
                            b_vault_lp_mint: self.b_vault_lp_mint.to_account_info(),
                            a_vault_lp: self.a_vault_lp.to_account_info(),
                            b_vault_lp: self.b_vault_lp.to_account_info(),
                            token_program: self.token_program.to_account_info(),
                            escrow_vault: self.escrow_vault.to_account_info(),
                            lock_escrow: self.lock_escrow.to_account_info(),
                            owner: self.pool_authority.to_account_info(),
                            source_tokens: self.source_tokens.to_account_info(),
                        },
                        &[&pool_authority_seeds[..]],
                    ),
                    max_amount,
                )
            },
            self.pool_authority.to_account_info(),
        )?;

        Ok(())
    }
}
pub fn handle_migrate_meteora_damm_lock_lp_token<'info>(
    ctx: Context<'_, '_, '_, 'info, MigrateMeteoraDammLockLpTokenCtx<'info>>,
) -> Result<()> {
    let virtual_pool = ctx.accounts.virtual_pool.load()?;

    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::CreatedPool,
        PoolError::NotPermitToDoThisAction
    );

    let mut migration_metadata = ctx.accounts.migration_metadata.load_mut()?;

    let is_partner = ctx.accounts.owner.key() == migration_metadata.partner;
    let is_creator = ctx.accounts.owner.key() == virtual_pool.creator;

    let lp_to_lock = match (is_partner, is_creator) {
        (true, true) => migration_metadata.lock_as_self_partnered_creator()?,
        (true, false) => migration_metadata.lock_as_partner()?,
        (false, true) => migration_metadata.lock_as_creator()?,
        (false, false) => return Err(PoolError::InvalidOwnerAccount.into()),
    };

    ctx.accounts
        .lock(const_pda::pool_authority::BUMP, lp_to_lock)
}
