use crate::{
    const_pda,
    constants::seeds::BASE_LOCKER_PREFIX,
    cpi_checker::cpi_with_account_lamport_and_owner_checking,
    remaining_accounts::{parse_transfer_hook_accounts, TransferHookAccountsInfo},
    state::MigrationProgress,
    *,
};
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use locker::cpi::accounts::CreateVestingEscrowV2;
use locker::types as locker_types;

#[derive(Accounts)]
pub struct CreateLockerCtx<'info> {
    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,
    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: UncheckedAccount<'info>,
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

pub fn handle_create_locker<'info>(
    ctx: Context<'info, CreateLockerCtx<'info>>,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<()> {
    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.virtual_pool)?;
    let mut virtual_pool = pool_loader.load_mut()?;

    require!(
        virtual_pool.config.eq(&ctx.accounts.config.key()),
        PoolError::InvalidAccount
    );
    require!(
        virtual_pool.creator.eq(&ctx.accounts.creator.key()),
        PoolError::InvalidAccount
    );
    require!(
        virtual_pool.base_vault.eq(&ctx.accounts.base_vault.key()),
        PoolError::InvalidAccount
    );
    require!(
        virtual_pool.base_mint.eq(&ctx.accounts.base_mint.key()),
        PoolError::InvalidAccount
    );

    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::PostBondingCurve,
        PoolError::NotPermitToDoThisAction
    );

    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;

    let locked_vesting_params = config.locked_vesting_config.to_locked_vesting_params();

    let vesting_params = locked_vesting_params
        .to_create_vesting_escrow_params(virtual_pool.finish_curve_timestamp)?;

    let virtual_pool_key = ctx.accounts.virtual_pool.key();
    let base_seeds = base_locker_seeds!(virtual_pool_key, ctx.bumps.base);

    let pool_authority_seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);

    let mut remaining_accounts = ctx.remaining_accounts;
    let parsed_transfer_hook_accounts =
        parse_transfer_hook_accounts(&mut remaining_accounts, &transfer_hook_accounts_info.slices)?;

    let (locker_remaining_accounts_info, cpi_remaining_accounts) =
        if let Some(transfer_hook_accounts) = parsed_transfer_hook_accounts.transfer_hook_base {
            (
                Some(locker_types::RemainingAccountsInfo {
                    slices: vec![locker_types::RemainingAccountsSlice {
                        accounts_type: locker_types::AccountsType::TransferHookEscrow,
                        length: transfer_hook_accounts.len() as u8,
                    }],
                }),
                transfer_hook_accounts.to_vec(),
            )
        } else {
            (None, vec![])
        };

    let create_locker_fn = || {
        flash_rent(
            ctx.accounts.pool_authority.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            || {
                msg!("create vesting escrow for creator");
                locker::cpi::create_vesting_escrow_v2(
                    CpiContext::new_with_signer(
                        ctx.accounts.locker_program.key(),
                        CreateVestingEscrowV2 {
                            base: ctx.accounts.base.to_account_info(),
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
                    )
                    .with_remaining_accounts(cpi_remaining_accounts.clone()),
                    vesting_params,
                    locker_remaining_accounts_info.clone(),
                )?;

                Ok(())
            },
        )
    };

    cpi_with_account_lamport_and_owner_checking(
        create_locker_fn,
        ctx.accounts.pool_authority.to_account_info(),
    )?;

    // set progress
    virtual_pool.set_migration_progress(MigrationProgress::LockedVesting.into());

    Ok(())
}
