use std::u64;

use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::{
    token_2022::{set_authority, spl_token_2022::instruction::AuthorityType, SetAuthority},
    token_interface::{TokenAccount, TokenInterface},
};
use damm_v2::types::{
    AddLiquidityParameters, BaseFeeParameters, InitializeCustomizablePoolParameters,
    InitializePoolParameters, PoolFeeParameters,
};
use ruint::aliases::U512;

use crate::{
    const_pda,
    constants::{fee::FEE_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    curve::{get_initial_liquidity_from_delta_base, get_initial_liquidity_from_delta_quote},
    params::fee_parameters::{to_bps, to_numerator},
    safe_math::SafeMath,
    state::{
        LiquidityDistribution, MigrationAmount, MigrationFeeOption, MigrationOption,
        MigrationProgress, PoolConfig, VirtualPool,
    },
    *,
};

#[derive(Accounts)]
pub struct MigrateDammV2Ctx<'info> {
    /// virtual pool
    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = config)]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    /// migration metadata
    #[account(has_one = virtual_pool)]
    pub migration_metadata: AccountLoader<'info, MeteoraDammV2Metadata>,

    /// virtual pool config key
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,

    /// CHECK: pool
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    // CHECK: damm-v2 config key
    // pub damm_config: AccountLoader<'info, damm_v2::accounts::Config>,
    /// CHECK: position nft mint for partner
    #[account(mut)]
    pub first_position_nft_mint: UncheckedAccount<'info>,

    /// CHECK: position nft account for partner
    #[account(mut)]
    pub first_position_nft_account: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub first_position: UncheckedAccount<'info>,

    /// CHECK: position nft mint for owner
    #[account(mut, constraint = first_position_nft_mint.key().ne(&second_position_nft_mint.key()))]
    pub second_position_nft_mint: Option<UncheckedAccount<'info>>,

    /// CHECK: position nft account for owner
    #[account(mut)]
    pub second_position_nft_account: Option<UncheckedAccount<'info>>,

    /// CHECK:
    #[account(mut)]
    pub second_position: Option<UncheckedAccount<'info>>,

    /// CHECK: damm pool authority
    pub damm_pool_authority: UncheckedAccount<'info>,

    /// CHECK:
    #[account(address = damm_v2::ID)]
    pub amm_program: UncheckedAccount<'info>,

    /// CHECK: base token mint
    #[account(mut)]
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: quote token mint
    #[account(mut)]
    pub quote_mint: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,
    /// CHECK: base_vault
    #[account(
        mut,
        token::mint = base_mint,
        token::token_program = token_base_program
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: quote vault
    #[account(
        mut,
        token::mint = quote_mint,
        token::token_program = token_quote_program
    )]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: payer
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: token_program
    pub token_base_program: Interface<'info, TokenInterface>,
    /// CHECK: token_program
    pub token_quote_program: Interface<'info, TokenInterface>,
    /// CHECK: token_program
    pub token_2022_program: Interface<'info, TokenInterface>,
    /// CHECK: damm event authority
    pub damm_event_authority: UncheckedAccount<'info>,
    /// System program.
    pub system_program: Program<'info, System>,
}

impl<'info> MigrateDammV2Ctx<'info> {
    fn validate_config_key(
        &self,
        damm_config: &damm_v2::accounts::Config,
        migration_fee_option: MigrationFeeOption,
    ) -> Result<()> {
        // validate config key
        match migration_fee_option {
            MigrationFeeOption::Customizable => {
                // nothing to check
            }
            MigrationFeeOption::FixedBps25
            | MigrationFeeOption::FixedBps30
            | MigrationFeeOption::FixedBps100
            | MigrationFeeOption::FixedBps200
            | MigrationFeeOption::FixedBps400
            | MigrationFeeOption::FixedBps600 => {
                let base_fee_bps = to_bps(
                    damm_config.pool_fees.base_fee.cliff_fee_numerator.into(),
                    1_000_000_000, // damm v2 using the same fee denominator with virtual curve
                )?;
                // validate non fee scheduler
                require!(
                    damm_config.pool_fees.base_fee.period_frequency == 0,
                    PoolError::InvalidConfigAccount
                );
                migration_fee_option.validate_base_fee(base_fee_bps)?;

                require!(
                    damm_config.pool_fees.partner_fee_percent == 0,
                    PoolError::InvalidConfigAccount
                );

                require!(
                    damm_config.sqrt_min_price == MIN_SQRT_PRICE,
                    PoolError::InvalidConfigAccount
                );

                require!(
                    damm_config.sqrt_max_price == MAX_SQRT_PRICE,
                    PoolError::InvalidConfigAccount
                );

                require!(
                    damm_config.vault_config_key == Pubkey::default(),
                    PoolError::InvalidConfigAccount
                );
            }
        }

        require!(
            damm_config.pool_creator_authority == self.pool_authority.key(),
            PoolError::InvalidConfigAccount
        );

        Ok(())
    }

    fn create_pool(
        &self,
        pool_config: AccountInfo<'info>,
        liquidity: u128,
        sqrt_price: u128,
        bump: u8,
        migration_fee_option: MigrationFeeOption,
        config: &PoolConfig,
    ) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);

        // Send some lamport to pool authority to pay rent fee?
        msg!("transfer lamport to pool_authority");
        invoke(
            &system_instruction::transfer(
                &self.payer.key(),
                &self.pool_authority.key(),
                50_000_000, // TODO calculate correct lamport here
            ),
            &[
                self.payer.to_account_info(),
                self.pool_authority.to_account_info(),
                self.system_program.to_account_info(),
            ],
        )?;

        if migration_fee_option == MigrationFeeOption::Customizable {
            let base_fee_numerator =
                to_numerator(config.migrated_pool_fee_bps.into(), FEE_DENOMINATOR.into())?;
            let base_fee = BaseFeeParameters {
                cliff_fee_numerator: base_fee_numerator,
                ..Default::default()
            };

            let migrated_dynamic_fee = DammV2DynamicFee::try_from(config.migrated_dynamic_fee)
                .map_err(|_| PoolError::InvalidCollectFeeMode)?;

            let dynamic_fee_params = if migrated_dynamic_fee == DammV2DynamicFee::Enable {
                Some(calculate_dynamic_fee_params(base_fee_numerator)?)
            } else {
                None
            };

            let pool_fees = PoolFeeParameters {
                base_fee,
                protocol_fee_percent: 20,
                partner_fee_percent: 0,
                referral_fee_percent: 20,
                dynamic_fee: dynamic_fee_params,
            };

            let collect_fee_mode =
                convert_collect_fee_mode_to_dammv2(config.migrated_collect_fee_mode)?;
            let initialize_pool_params = InitializeCustomizablePoolParameters {
                pool_fees,
                sqrt_min_price: MIN_SQRT_PRICE,
                sqrt_max_price: MAX_SQRT_PRICE,
                has_alpha_vault: false,
                liquidity,
                sqrt_price,
                activation_type: 1, // timestamp
                collect_fee_mode,
                activation_point: None,
            };
            damm_v2::cpi::initialize_pool_with_dynamic_config(
                CpiContext::new_with_signer(
                    self.amm_program.to_account_info(),
                    damm_v2::cpi::accounts::InitializePoolWithDynamicConfig {
                        creator: self.pool_authority.to_account_info(),
                        position_nft_mint: self.first_position_nft_mint.to_account_info(),
                        position_nft_account: self.first_position_nft_account.to_account_info(),
                        payer: self.pool_authority.to_account_info(),
                        pool_creator_authority: self.pool_authority.to_account_info(),
                        config: pool_config.to_account_info(),
                        pool_authority: self.damm_pool_authority.to_account_info(),
                        pool: self.pool.to_account_info(),
                        position: self.first_position.to_account_info(),
                        token_a_mint: self.base_mint.to_account_info(),
                        token_b_mint: self.quote_mint.to_account_info(),
                        token_a_vault: self.token_a_vault.to_account_info(),
                        token_b_vault: self.token_b_vault.to_account_info(),
                        payer_token_a: self.base_vault.to_account_info(),
                        payer_token_b: self.quote_vault.to_account_info(),
                        token_a_program: self.token_base_program.to_account_info(),
                        token_b_program: self.token_quote_program.to_account_info(),
                        token_2022_program: self.token_2022_program.to_account_info(),
                        system_program: self.system_program.to_account_info(),
                        event_authority: self.damm_event_authority.to_account_info(),
                        program: self.amm_program.to_account_info(),
                    },
                    &[&pool_authority_seeds[..]],
                ),
                initialize_pool_params,
            )?;
        } else {
            damm_v2::cpi::initialize_pool(
                CpiContext::new_with_signer(
                    self.amm_program.to_account_info(),
                    damm_v2::cpi::accounts::InitializePool {
                        creator: self.pool_authority.to_account_info(),
                        position_nft_mint: self.first_position_nft_mint.to_account_info(),
                        position_nft_account: self.first_position_nft_account.to_account_info(),
                        payer: self.pool_authority.to_account_info(),
                        config: pool_config.to_account_info(),
                        pool_authority: self.damm_pool_authority.to_account_info(),
                        pool: self.pool.to_account_info(),
                        position: self.first_position.to_account_info(),
                        token_a_mint: self.base_mint.to_account_info(),
                        token_b_mint: self.quote_mint.to_account_info(),
                        token_a_vault: self.token_a_vault.to_account_info(),
                        token_b_vault: self.token_b_vault.to_account_info(),
                        payer_token_a: self.base_vault.to_account_info(),
                        payer_token_b: self.quote_vault.to_account_info(),
                        token_a_program: self.token_base_program.to_account_info(),
                        token_b_program: self.token_quote_program.to_account_info(),
                        token_2022_program: self.token_2022_program.to_account_info(),
                        system_program: self.system_program.to_account_info(),
                        event_authority: self.damm_event_authority.to_account_info(),
                        program: self.amm_program.to_account_info(),
                    },
                    &[&pool_authority_seeds[..]],
                ),
                InitializePoolParameters {
                    liquidity,
                    sqrt_price,
                    activation_point: None,
                },
            )?;
        }

        Ok(())
    }

    fn lock_permanent_liquidity_for_first_position(
        &self,
        permanent_lock_liquidity: u128,
        bump: u8,
    ) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);
        damm_v2::cpi::permanent_lock_position(
            CpiContext::new_with_signer(
                self.amm_program.to_account_info(),
                damm_v2::cpi::accounts::PermanentLockPosition {
                    pool: self.pool.to_account_info(),
                    position: self.first_position.to_account_info(),
                    position_nft_account: self.first_position_nft_account.to_account_info(),
                    owner: self.pool_authority.to_account_info(),
                    event_authority: self.damm_event_authority.to_account_info(),
                    program: self.amm_program.to_account_info(),
                },
                &[&pool_authority_seeds[..]],
            ),
            permanent_lock_liquidity,
        )?;
        Ok(())
    }

    fn set_authority_for_first_position(&self, new_authority: Pubkey, bump: u8) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);
        set_authority(
            CpiContext::new_with_signer(
                self.token_2022_program.to_account_info(),
                SetAuthority {
                    current_authority: self.pool_authority.to_account_info(),
                    account_or_mint: self.first_position_nft_account.to_account_info(),
                },
                &[&pool_authority_seeds[..]],
            ),
            AuthorityType::AccountOwner,
            Some(new_authority),
        )?;
        Ok(())
    }
    fn create_second_position(
        &self,
        owner: Pubkey,
        liquidity: u128,
        locked_liquidity: u128,
        bump: u8,
    ) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);
        msg!("create position");
        damm_v2::cpi::create_position(CpiContext::new_with_signer(
            self.amm_program.to_account_info(),
            damm_v2::cpi::accounts::CreatePosition {
                owner: self.pool_authority.to_account_info(),
                pool: self.pool.to_account_info(),
                position_nft_mint: self
                    .second_position_nft_mint
                    .clone()
                    .unwrap()
                    .to_account_info(),
                position_nft_account: self
                    .second_position_nft_account
                    .clone()
                    .unwrap()
                    .to_account_info(),
                position: self.second_position.clone().unwrap().to_account_info(),
                pool_authority: self.damm_pool_authority.to_account_info(),
                payer: self.payer.to_account_info(),
                token_program: self.token_2022_program.to_account_info(),
                system_program: self.system_program.to_account_info(),
                event_authority: self.damm_event_authority.to_account_info(),
                program: self.amm_program.to_account_info(),
            },
            &[&pool_authority_seeds[..]],
        ))?;

        msg!("add liquidity");
        let total_liquidity = liquidity.safe_add(locked_liquidity)?;
        damm_v2::cpi::add_liquidity(
            CpiContext::new_with_signer(
                self.amm_program.to_account_info(),
                damm_v2::cpi::accounts::AddLiquidity {
                    pool: self.pool.to_account_info(),
                    position: self.second_position.clone().unwrap().to_account_info(),
                    token_a_account: self.base_vault.to_account_info(),
                    token_b_account: self.quote_vault.to_account_info(),
                    token_a_vault: self.token_a_vault.to_account_info(),
                    token_b_vault: self.token_b_vault.to_account_info(),
                    token_a_mint: self.base_mint.to_account_info(),
                    token_b_mint: self.quote_mint.to_account_info(),
                    position_nft_account: self
                        .second_position_nft_account
                        .clone()
                        .unwrap()
                        .to_account_info(),
                    owner: self.pool_authority.to_account_info(),
                    token_a_program: self.token_base_program.to_account_info(),
                    token_b_program: self.token_quote_program.to_account_info(),
                    event_authority: self.damm_event_authority.to_account_info(),
                    program: self.amm_program.to_account_info(),
                },
                &[&pool_authority_seeds[..]],
            ),
            AddLiquidityParameters {
                liquidity_delta: total_liquidity,
                token_a_amount_threshold: u64::MAX, // TODO should we take care for that
                token_b_amount_threshold: u64::MAX,
            },
        )?;

        if locked_liquidity > 0 {
            msg!("lock liquidity");
            damm_v2::cpi::permanent_lock_position(
                CpiContext::new_with_signer(
                    self.amm_program.to_account_info(),
                    damm_v2::cpi::accounts::PermanentLockPosition {
                        pool: self.pool.to_account_info(),
                        position: self.second_position.clone().unwrap().to_account_info(),
                        position_nft_account: self
                            .second_position_nft_account
                            .clone()
                            .unwrap()
                            .to_account_info(),
                        owner: self.pool_authority.to_account_info(),
                        event_authority: self.damm_event_authority.to_account_info(),
                        program: self.amm_program.to_account_info(),
                    },
                    &[&pool_authority_seeds[..]],
                ),
                locked_liquidity,
            )?;
        }

        msg!("set authority");
        set_authority(
            CpiContext::new_with_signer(
                self.token_2022_program.to_account_info(),
                SetAuthority {
                    current_authority: self.pool_authority.to_account_info(),
                    account_or_mint: self
                        .second_position_nft_account
                        .clone()
                        .unwrap()
                        .to_account_info(),
                },
                &[&pool_authority_seeds[..]],
            ),
            AuthorityType::AccountOwner,
            Some(owner),
        )?;

        Ok(())
    }
}

pub fn handle_migrate_damm_v2<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, MigrateDammV2Ctx<'info>>,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let migration_fee_option = MigrationFeeOption::try_from(config.migration_fee_option)
        .map_err(|_| PoolError::InvalidMigrationFeeOption)?;
    {
        require!(
            ctx.remaining_accounts.len() == 1,
            PoolError::MissingPoolConfigInRemainingAccount
        );
        let damm_config_loader: AccountLoader<'_, damm_v2::accounts::Config> =
            AccountLoader::try_from(&ctx.remaining_accounts[0])?; // TODO fix damm config in remaning accounts
        let damm_config = damm_config_loader.load()?;
        ctx.accounts
            .validate_config_key(&damm_config, migration_fee_option)?;
    }

    let mut virtual_pool = ctx.accounts.virtual_pool.load_mut()?;

    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::LockedVesting,
        PoolError::NotPermitToDoThisAction
    );

    let migration_metadata = ctx.accounts.migration_metadata.load()?;

    require!(
        virtual_pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::PoolIsIncompleted
    );

    let migration_option = MigrationOption::try_from(config.migration_option)
        .map_err(|_| PoolError::InvalidMigrationOption)?;
    require!(
        migration_option == MigrationOption::DammV2,
        PoolError::InvalidMigrationOption
    );
    let initial_quote_vault_amount = ctx.accounts.quote_vault.amount;
    let initial_base_vault_amount = ctx.accounts.base_vault.amount;

    let protocol_and_partner_base_fee = virtual_pool.get_protocol_and_trading_base_fee()?;
    let migration_sqrt_price = config.migration_sqrt_price;

    let MigrationAmount { quote_amount, .. } = config.get_migration_quote_amount_for_config()?;
    let excluded_fee_base_reserve =
        initial_base_vault_amount.safe_sub(protocol_and_partner_base_fee)?;

    // calculate initial liquidity
    let initial_liquidity = get_liquidity_for_adding_liquidity(
        excluded_fee_base_reserve,
        quote_amount,
        migration_sqrt_price,
    )?;

    let LiquidityDistribution {
        partner: partner_liquidity_distribution,
        creator: creator_liquidity_distribution,
    } = config.get_liquidity_distribution(initial_liquidity)?;

    let (
        first_position_liquidity_distribution,
        second_position_liquidity_distribution,
        first_position_owner,
        second_position_owner,
    ) = if partner_liquidity_distribution.get_total_liquidity()?
        > creator_liquidity_distribution.get_total_liquidity()?
    {
        (
            partner_liquidity_distribution,
            creator_liquidity_distribution,
            migration_metadata.partner,
            virtual_pool.creator,
        )
    } else {
        (
            creator_liquidity_distribution,
            partner_liquidity_distribution,
            virtual_pool.creator,
            migration_metadata.partner,
        )
    };

    // create pool
    msg!("create pool");
    ctx.accounts.create_pool(
        ctx.remaining_accounts[0].clone(),
        first_position_liquidity_distribution.get_total_liquidity()?,
        config.migration_sqrt_price,
        const_pda::pool_authority::BUMP,
        migration_fee_option,
        &config,
    )?;
    // lock permanent liquidity
    if first_position_liquidity_distribution.locked_liquidity > 0 {
        msg!("lock permanent liquidity for first position");
        ctx.accounts.lock_permanent_liquidity_for_first_position(
            first_position_liquidity_distribution.locked_liquidity,
            const_pda::pool_authority::BUMP,
        )?;
    }

    msg!("transfer ownership of the first position");
    ctx.accounts
        .set_authority_for_first_position(first_position_owner, const_pda::pool_authority::BUMP)?;

    // reload quote reserve and base reserve
    ctx.accounts.quote_vault.reload()?;
    ctx.accounts.base_vault.reload()?;
    let deposited_base_amount =
        initial_base_vault_amount.safe_sub(ctx.accounts.base_vault.amount)?;
    let deposited_quote_amount =
        initial_quote_vault_amount.safe_sub(ctx.accounts.quote_vault.amount)?;

    let updated_excluded_fee_base_reserve =
        excluded_fee_base_reserve.safe_sub(deposited_base_amount)?;
    let updated_quote_threshold = quote_amount.safe_sub(deposited_quote_amount)?;
    let liquidity_for_second_position = get_liquidity_for_adding_liquidity(
        updated_excluded_fee_base_reserve,
        updated_quote_threshold,
        migration_sqrt_price,
    )?;

    if liquidity_for_second_position > 0 {
        msg!("create second position");
        let unlocked_lp = liquidity_for_second_position
            .min(second_position_liquidity_distribution.unlocked_liquidity);
        let locked_lp = liquidity_for_second_position.safe_sub(unlocked_lp)?;
        ctx.accounts.create_second_position(
            second_position_owner,
            unlocked_lp,
            locked_lp,
            const_pda::pool_authority::BUMP,
        )?;
    }

    virtual_pool.update_after_create_pool();

    // burn the rest of token in pool authority after migrated amount and fee
    ctx.accounts.base_vault.reload()?;

    // check whether we should burn token

    let left_base_token = ctx
        .accounts
        .base_vault
        .amount
        .safe_sub(protocol_and_partner_base_fee)?;

    let burnable_amount = config.get_burnable_amount_post_migration(left_base_token)?;

    if burnable_amount > 0 {
        let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
        anchor_spl::token_interface::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_base_program.to_account_info(),
                anchor_spl::token_interface::Burn {
                    mint: ctx.accounts.base_mint.to_account_info(),
                    from: ctx.accounts.base_vault.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[&seeds[..]],
            ),
            burnable_amount,
        )?;
    }

    virtual_pool.set_migration_progress(MigrationProgress::CreatedPool.into());

    // TODO emit event

    Ok(())
}

fn get_liquidity_for_adding_liquidity(
    base_amount: u64,
    quote_amount: u64,
    sqrt_price: u128,
) -> Result<u128> {
    let liquidity_from_base =
        get_initial_liquidity_from_delta_base(base_amount, MAX_SQRT_PRICE, sqrt_price)?;
    let liquidity_from_quote =
        get_initial_liquidity_from_delta_quote(quote_amount, MIN_SQRT_PRICE, sqrt_price)?;
    if liquidity_from_base > U512::from(liquidity_from_quote) {
        Ok(liquidity_from_quote)
    } else {
        Ok(liquidity_from_base
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }
}
