use crate::{
    const_pda,
    constants::seeds::BASE_LOCKER_PREFIX,
    state::{MigrationProgress, PoolConfig, VirtualPool},
    *,
};
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use locker::cpi::accounts::CreateVestingEscrowV2;

#[derive(Accounts)]
pub struct CreateLockerCtx<'info> {
    /// Virtual pool
    #[account(mut, has_one = config, has_one = creator, has_one = base_vault, has_one = base_mint)]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,
    /// Config
    pub config: AccountLoader<'info, PoolConfig>,
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,
    /// CHECK: base_vault
    #[account(
        mut,
        token::mint = base_mint,
        token::token_program = token_program
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: base token mint
    #[account(mut)]
    pub base_mint: UncheckedAccount<'info>,

    /// CHECK: base key to create locked escrow
    #[account(
        mut,
        seeds = [
            BASE_LOCKER_PREFIX.as_ref(),
            virtual_pool.key().as_ref(),
        ],
        bump,
    )]
    pub base: UncheckedAccount<'info>,
    /// CHECK: owner
    pub creator: UncheckedAccount<'info>,
    /// CHECK: escrow of locker, derived from base
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,

    /// CHECK: ATA escrow token, needs to be pre-created by the caller
    #[account(mut)]
    pub escrow_token: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: token_program
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Locker program
    #[account(address = locker::ID)]
    pub locker_program: UncheckedAccount<'info>,

    /// CHECK: Locker event authority
    pub locker_event_authority: UncheckedAccount<'info>,

    /// System program.
    pub system_program: Program<'info, System>,
}

pub fn handle_create_locker(ctx: Context<CreateLockerCtx>) -> Result<()> {
    let mut virtual_pool = ctx.accounts.virtual_pool.load_mut()?;

    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::PostBondingCurve,
        PoolError::NotPermitToDoThisAction
    );

    let config = ctx.accounts.config.load()?;

    let locked_vesting_params = config.locked_vesting_config.to_locked_vesting_params();

    let vesting_params = locked_vesting_params
        .to_create_vesting_escrow_params(virtual_pool.finish_curve_timestamp)?;

    let virtual_pool_key = ctx.accounts.virtual_pool.key();
    let base_seeds = base_locker_seeds!(virtual_pool_key, ctx.bumps.base);

    let pool_authority_seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);

    flash_rent(
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        || {
            msg!("create vesting escrow for creator");
            locker::cpi::create_vesting_escrow_v2(
                CpiContext::new_with_signer(
                    ctx.accounts.locker_program.to_account_info(),
                    CreateVestingEscrowV2 {
                        base: ctx.accounts.base.to_account_info(), // use payer token account for base key, unique
                        escrow: ctx.accounts.escrow.to_account_info(),
                        escrow_token: ctx.accounts.escrow_token.to_account_info(),
                        token_mint: ctx.accounts.base_mint.to_account_info(),
                        sender: ctx.accounts.pool_authority.to_account_info(),
                        sender_token: ctx.accounts.base_vault.to_account_info(),
                        recipient: ctx.accounts.creator.to_account_info(),
                        token_program: ctx.accounts.token_program.to_account_info(),
                        system_program: ctx.accounts.system_program.to_account_info(),
                        event_authority: ctx.accounts.locker_event_authority.to_account_info(),
                        program: ctx.accounts.locker_program.to_account_info(),
                    },
                    &[&base_seeds[..], &pool_authority_seeds[..]],
                ),
                vesting_params,
                None,
            )?;

            Ok(())
        },
    )?;

    // set progress
    virtual_pool.set_migration_progress(MigrationProgress::LockedVesting.into());

    Ok(())
}
