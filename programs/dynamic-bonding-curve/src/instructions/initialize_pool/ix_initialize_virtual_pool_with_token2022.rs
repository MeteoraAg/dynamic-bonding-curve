use super::InitializePoolParameters;
use super::{max_key, min_key};
use crate::{
    activation_handler::get_current_point,
    const_pda,
    constants::seeds::{POOL_PREFIX, TOKEN_VAULT_PREFIX},
    state::fee::VolatilityTracker,
    state::{PoolConfig, PoolType, TokenType, VirtualPool},
    token::update_account_lamports_to_minimum_balance,
    EvtInitializePool, PoolError,
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_interface::spl_pod::optional_keys::OptionalNonZeroPubkey;
use anchor_spl::{
    token_2022::{mint_to, MintTo, Token2022},
    token_interface::{
        token_metadata_initialize, token_metadata_update_authority, Mint, TokenAccount,
        TokenInterface, TokenMetadataInitialize,
    },
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVirtualPoolWithToken2022Ctx<'info> {
    /// Which config the pool belongs to.
    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: AccountInfo<'info>,

    pub creator: Signer<'info>,

    /// Unique token mint address, initialize in contract
    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_program,
        mint::decimals = config.load()?.token_decimal,
        mint::authority = pool_authority,
        extensions::metadata_pointer::authority = pool_authority,
        extensions::metadata_pointer::metadata_address = base_mint,
    )]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mint::token_program = token_quote_program,
    )]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            POOL_PREFIX.as_ref(),
            config.key().as_ref(),
            &max_key(&base_mint.key(), &quote_mint.key()),
            &min_key(&base_mint.key(), &quote_mint.key()),
        ],
        bump,
        payer = payer,
        space = 8 + VirtualPool::INIT_SPACE
    )]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// CHECK: Token base vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            base_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = base_mint,
        token::authority = pool_authority,
        token::token_program = token_program,
        payer = payer,
        bump,
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token quote vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            quote_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = quote_mint,
        token::authority = pool_authority,
        token::token_program = token_quote_program,
        payer = payer,
        bump,
    )]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Program to create mint account and mint tokens
    pub token_quote_program: Interface<'info, TokenInterface>,
    /// token program for base mint
    pub token_program: Program<'info, Token2022>,
    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_virtual_pool_with_token2022<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, InitializeVirtualPoolWithToken2022Ctx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let token_type_value =
        TokenType::try_from(config.token_type).map_err(|_| PoolError::InvalidTokenType)?;
    require!(
        token_type_value == TokenType::Token2022,
        PoolError::InvalidTokenType
    );

    let InitializePoolParameters { name, symbol, uri } = params;

    // initialize metadata
    let cpi_accounts = TokenMetadataInitialize {
        program_id: ctx.accounts.token_program.to_account_info(),
        mint: ctx.accounts.base_mint.to_account_info(),
        metadata: ctx.accounts.base_mint.to_account_info(),
        mint_authority: ctx.accounts.pool_authority.to_account_info(),
        update_authority: ctx.accounts.creator.to_account_info(),
    };
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    let signer_seeds = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token_metadata_initialize(cpi_ctx, name, symbol, uri)?;

    // transfer minimum rent to mint account
    update_account_lamports_to_minimum_balance(
        ctx.accounts.base_mint.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    )?;

    let token_authority = config.get_token_authority()?;

    let token_update_authority =
        token_authority.get_update_authority(ctx.accounts.creator.key(), config.fee_claimer.key());

    anchor_spl::token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::SetAuthority {
                current_authority: ctx.accounts.pool_authority.to_account_info(),
                account_or_mint: ctx.accounts.base_mint.to_account_info(),
            },
            &[&seeds[..]],
        ),
        AuthorityType::MetadataPointer,
        token_update_authority,
    )?;

    // update token metadata update authority
    let new_update_token_metadata_authority =
        OptionalNonZeroPubkey::try_from(token_update_authority)?;

    token_metadata_update_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::TokenMetadataUpdateAuthority {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: ctx.accounts.base_mint.to_account_info(),
                current_authority: ctx.accounts.creator.to_account_info(),
                // new authority isn't actually needed as account in the CPI
                // use current authority as system_program to satisfy the struct
                // https://github.com/solana-developers/program-examples/blob/main/tokens/token-2022/metadata/anchor/programs/metadata/src/instructions/update_authority.rs
                new_authority: ctx.accounts.system_program.to_account_info(),
            },
            &[&seeds[..]],
        ),
        new_update_token_metadata_authority,
    )?;

    let config = ctx.accounts.config.load()?;
    let initial_base_supply = config.get_initial_base_supply()?;

    // mint token
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.base_mint.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[&seeds[..]],
        ),
        initial_base_supply,
    )?;

    // update mint authority
    let token_mint_authority =
        token_authority.get_mint_authority(ctx.accounts.creator.key(), config.fee_claimer.key());

    anchor_spl::token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::SetAuthority {
                current_authority: ctx.accounts.pool_authority.to_account_info(),
                account_or_mint: ctx.accounts.base_mint.to_account_info(),
            },
            &[&seeds[..]],
        ),
        AuthorityType::MintTokens,
        token_mint_authority,
    )?;

    // init pool
    let mut pool = ctx.accounts.pool.load_init()?;

    let activation_point = get_current_point(config.activation_type)?;

    pool.initialize(
        VolatilityTracker::default(),
        ctx.accounts.config.key(),
        ctx.accounts.creator.key(),
        ctx.accounts.base_mint.key(),
        ctx.accounts.base_vault.key(),
        ctx.accounts.quote_vault.key(),
        config.sqrt_start_price,
        PoolType::Token2022.into(),
        activation_point,
        initial_base_supply,
    );

    emit_cpi!(EvtInitializePool {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        creator: ctx.accounts.creator.key(),
        base_mint: ctx.accounts.base_mint.key(),
        pool_type: PoolType::Token2022.into(),
        activation_point,
    });
    Ok(())
}
