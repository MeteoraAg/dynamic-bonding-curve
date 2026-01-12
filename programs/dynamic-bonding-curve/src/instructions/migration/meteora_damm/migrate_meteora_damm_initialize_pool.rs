use anchor_spl::token::{Burn, Token, TokenAccount};
use ruint::aliases::U256;

use crate::{
    const_pda,
    constants::BASIS_POINT_MAX,
    cpi_checker::cpi_with_account_lamport_and_owner_checking,
    params::fee_parameters::to_bps,
    safe_math::SafeMath,
    state::{
        MigrationAmount, MigrationFeeOption, MigrationOption, MigrationProgress, PoolConfig,
        VirtualPool,
    },
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
    *,
};

#[derive(Accounts)]
pub struct MigrateMeteoraDammCtx<'info> {
    /// virtual pool
    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = config)]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    #[account(mut, has_one = virtual_pool)]
    pub migration_metadata: AccountLoader<'info, MeteoraDammMigrationMetadata>,

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

    /// pool config
    pub damm_config: Box<Account<'info, dynamic_amm::accounts::Config>>,

    /// CHECK: lp_mint
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,

    /// CHECK: base token mint
    #[account(mut)]
    pub token_a_mint: UncheckedAccount<'info>, // match with vault.base_mint
    /// CHECK: quote token mint
    pub token_b_mint: UncheckedAccount<'info>, // match with vault.quote_mint

    /// CHECK: a vault
    #[account(mut)]
    pub a_vault: UncheckedAccount<'info>,
    /// CHECK: b vault
    #[account(mut)]
    pub b_vault: UncheckedAccount<'info>,
    /// CHECK: a token vault
    #[account(mut)]
    pub a_token_vault: UncheckedAccount<'info>,
    /// CHECK: b token vault
    #[account(mut)]
    pub b_token_vault: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: a vault lp mint
    pub a_vault_lp_mint: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: b vault lp mint
    pub b_vault_lp_mint: UncheckedAccount<'info>,
    /// CHECK: a vault lp
    #[account(mut)]
    pub a_vault_lp: UncheckedAccount<'info>,
    /// CHECK: b vault lp
    #[account(mut)]
    pub b_vault_lp: UncheckedAccount<'info>,
    /// CHECK: virtual pool token a
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: virtual pool token b
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: virtual pool lp
    #[account(mut)]
    pub virtual_pool_lp: UncheckedAccount<'info>, // TODO check this address and validate

    /// CHECK: protocol token a fee
    #[account(mut)]
    pub protocol_token_a_fee: UncheckedAccount<'info>,

    /// CHECK: protocol token b fee
    #[account(mut)]
    pub protocol_token_b_fee: UncheckedAccount<'info>,
    /// CHECK: payer
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    pub rent: UncheckedAccount<'info>,
    /// CHECK: mint_metadata
    #[account(mut)]
    pub mint_metadata: UncheckedAccount<'info>,

    /// CHECK: Metadata program
    pub metadata_program: UncheckedAccount<'info>,

    /// CHECK: amm_program
    #[account(address = dynamic_amm::ID)]
    pub amm_program: UncheckedAccount<'info>,

    /// CHECK: vault_program
    pub vault_program: UncheckedAccount<'info>,

    /// token_program
    pub token_program: Program<'info, Token>,

    /// CHECK: Associated token program.
    pub associated_token_program: UncheckedAccount<'info>,
    /// System program.
    pub system_program: Program<'info, System>,
}

impl<'info> MigrateMeteoraDammCtx<'info> {
    fn validate_config_key(&self, migration_fee_option: u8) -> Result<()> {
        let migration_fee_option = MigrationFeeOption::try_from(migration_fee_option)
            .map_err(|_| PoolError::InvalidMigrationFeeOption)?;
        let base_fee_bps = to_bps(
            self.damm_config.pool_fees.trade_fee_numerator.into(),
            self.damm_config.pool_fees.trade_fee_denominator.into(),
        )?;
        migration_fee_option.validate_base_fee(base_fee_bps)?;
        require!(
            self.damm_config.pool_creator_authority == self.pool_authority.key(),
            PoolError::InvalidConfigAccount
        );
        require!(
            self.damm_config.activation_duration == 0,
            PoolError::InvalidConfigAccount
        );
        require!(
            self.damm_config.partner_fee_numerator == 0,
            PoolError::InvalidConfigAccount
        );
        require!(
            self.damm_config.vault_config_key == Pubkey::default(),
            PoolError::InvalidConfigAccount
        );
        Ok(())
    }

    fn create_pool(
        &self,
        initial_base_amount: u64,
        initial_quote_amount: u64,
        bump: u8,
    ) -> Result<()> {
        let pool_authority_seeds = pool_authority_seeds!(bump);

        let create_pool_fn = || {
            flash_rent(
                self.pool_authority.to_account_info(),
                self.payer.to_account_info(),
                self.system_program.to_account_info(),
                || {
                    // Vault authority create pool
                    msg!("create pool");
                    dynamic_amm::cpi::initialize_permissionless_constant_product_pool_with_config2(
                CpiContext::new_with_signer(
                self.amm_program.to_account_info(),
                dynamic_amm::cpi::accounts::InitializePermissionlessConstantProductPoolWithConfig2 {
                            pool: self.pool.to_account_info(),
                            config: self.damm_config.to_account_info(),
                            lp_mint: self.lp_mint.to_account_info(),
                            token_a_mint: self.token_a_mint.to_account_info(),
                            token_b_mint: self.token_b_mint.to_account_info(),
                            a_vault: self.a_vault.to_account_info(),
                            b_vault: self.b_vault.to_account_info(),
                            a_token_vault: self.a_token_vault.to_account_info(),
                            b_token_vault: self.b_token_vault.to_account_info(),
                            a_vault_lp_mint: self.a_vault_lp_mint.to_account_info(),
                            b_vault_lp_mint: self.b_vault_lp_mint.to_account_info(),
                            a_vault_lp: self.a_vault_lp.to_account_info(),
                            b_vault_lp: self.b_vault_lp.to_account_info(),
                            payer_token_a: self.base_vault.to_account_info(),
                            payer_token_b: self.quote_vault.to_account_info(),
                            payer_pool_lp: self.virtual_pool_lp.to_account_info(), // ?
                            protocol_token_a_fee: self.protocol_token_a_fee.to_account_info(),
                            protocol_token_b_fee: self.protocol_token_b_fee.to_account_info(),
                            payer: self.pool_authority.to_account_info(),
                            rent: self.rent.to_account_info(),
                            metadata_program: self.metadata_program.to_account_info(),
                            mint_metadata: self.mint_metadata.to_account_info(),
                            vault_program: self.vault_program.to_account_info(),
                            token_program: self.token_program.to_account_info(),
                            associated_token_program: self.associated_token_program.to_account_info(),
                            system_program: self.system_program.to_account_info(),
                        },
                        &[&pool_authority_seeds[..]],
                    ),
                    initial_base_amount,
                    initial_quote_amount,
                    None,
                )?;

                    Ok(())
                },
            )
        };

        cpi_with_account_lamport_and_owner_checking(
            create_pool_fn,
            self.pool_authority.to_account_info(),
        )
    }
}

pub fn handle_migrate_meteora_damm<'info>(
    ctx: Context<'_, '_, '_, 'info, MigrateMeteoraDammCtx<'info>>,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    ctx.accounts
        .validate_config_key(config.migration_fee_option)?;

    let mut virtual_pool = ctx.accounts.virtual_pool.load_mut()?;
    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::LockedVesting,
        PoolError::NotPermitToDoThisAction
    );

    let mut migration_metadata = ctx.accounts.migration_metadata.load_mut()?;

    require!(
        virtual_pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::PoolIsIncompleted
    );

    let migration_option = MigrationOption::try_from(config.migration_option)
        .map_err(|_| PoolError::InvalidMigrationOption)?;
    require!(
        migration_option == MigrationOption::MeteoraDamm,
        PoolError::InvalidMigrationOption
    );

    let base_reserve = config.migration_base_threshold;
    let MigrationAmount { quote_amount, .. } = config.get_migration_quote_amount_for_config()?;

    let (protocol_liquidity_fee_base, protocol_liquidity_fee_quote) =
        get_protocol_liquidity_fee_tokens(
            quote_amount,
            config.migration_sqrt_price,
            virtual_pool.protocol_liquidity_migration_fee_bps,
        )?;

    virtual_pool.save_protocol_liquidity_migration_fee(
        protocol_liquidity_fee_base,
        protocol_liquidity_fee_quote,
    );

    let excluded_protocol_fee_base_amount = base_reserve.safe_sub(protocol_liquidity_fee_base)?;
    let excluded_protocol_fee_quote_amount = quote_amount.safe_sub(protocol_liquidity_fee_quote)?;

    ctx.accounts.create_pool(
        excluded_protocol_fee_base_amount,
        excluded_protocol_fee_quote_amount,
        const_pda::pool_authority::BUMP,
    )?;

    virtual_pool.update_after_create_pool();

    // burn the rest of token in pool authority after migrated amount and fee
    ctx.accounts.base_vault.reload()?;

    let non_burnable_amount = virtual_pool
        .get_protocol_and_trading_base_fee()?
        .safe_add(protocol_liquidity_fee_base)?;

    let left_base_token = ctx
        .accounts
        .base_vault
        .amount
        .safe_sub(non_burnable_amount)?;

    let burnable_amount = config.get_burnable_amount_post_migration(left_base_token)?;
    if burnable_amount > 0 {
        let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
        anchor_spl::token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.token_a_mint.to_account_info(),
                    from: ctx.accounts.base_vault.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[&seeds[..]],
            ),
            burnable_amount,
        )?;
    }

    let lp_minted_amount = anchor_spl::token::accessor::amount(&ctx.accounts.virtual_pool_lp)?;

    let liquidity_distribution = config.get_liquidity_distribution(lp_minted_amount.into())?;
    migration_metadata.set_liquidity_token_minted(
        ctx.accounts.lp_mint.key(),
        &liquidity_distribution.to_liquidity_distribution_damm_v1()?,
    );
    virtual_pool.set_migration_progress(MigrationProgress::CreatedPool.into());

    // TODO emit event

    Ok(())
}

fn get_protocol_liquidity_fee_tokens(
    quote_amount: u64,
    sqrt_price: u128,
    fee_bps: u16,
) -> Result<(u64, u64)> {
    let quote_fee_amount = safe_mul_div_cast_u64(
        quote_amount,
        fee_bps.into(),
        BASIS_POINT_MAX,
        Rounding::Down,
    )?;

    let sqrt_migration_price = U256::from(sqrt_price);
    let price = sqrt_migration_price.safe_mul(sqrt_migration_price)?;

    let base_fee_amount = U256::from(quote_fee_amount)
        .safe_shl(128)?
        .safe_div(U256::from(price))?
        .try_into()
        .map_err(|_| PoolError::MathOverflow)?;

    Ok((base_fee_amount, quote_fee_amount))
}

#[cfg(test)]
mod tests {
    use crate::constants::{
        fee::PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS, MAX_SQRT_PRICE, MIN_SQRT_PRICE,
    };

    use super::*;
    use proptest::prelude::*;

    // proptest! {
    //     #[test]
    //     fn test_protocol_fee_rounding_causes_price_increment(
    //         base_amount in 1_000_000..1_000_000_000_000u64,
    //         quote_amount in 1_000_000..1_000_000_000_000u64
    //     ) {
    //         let protocol_fee_base_amount: u64 = safe_mul_div_cast_u64(
    //             base_amount,
    //             PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into(),
    //             BASIS_POINT_MAX,
    //             Rounding::Down,
    //         ).unwrap();

    //         let protocol_fee_quote_amount: u64 = safe_mul_div_cast_u64(
    //             quote_amount,
    //             PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into(),
    //             BASIS_POINT_MAX,
    //             Rounding::Down,
    //         ).unwrap();

    //         let price_0 = quote_amount as f64 / base_amount as f64;

    //         let excluded_fee_base_amount = base_amount.safe_sub(protocol_fee_base_amount).unwrap();
    //         let excluded_fee_quote_amount = quote_amount.safe_sub(protocol_fee_quote_amount).unwrap();

    //         let price_1 = excluded_fee_quote_amount as f64 / excluded_fee_base_amount as f64;

    //         assert!(price_1 <= price_0);
    //     }
    // }

    proptest! {
        #[test]
        fn test_protocol_base_amount_computed_from_protocol_quote_amount_always_lesser(
            quote_amount in 10_000_000_000_000u64..u64::MAX,
            sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
        ) {
             let price = U256::from(sqrt_price)
                .safe_mul(U256::from(sqrt_price))
                .unwrap();

            let (base_migration_amount, rem) =
                    U256::from(quote_amount).safe_shl(128).unwrap().div_rem(price);

            let mut base_migration_amount: u64 = base_migration_amount.try_into().unwrap();

            if !rem.is_zero() {
                base_migration_amount = base_migration_amount.safe_add(1).unwrap();
            }

            if base_migration_amount == 0 {
                return Ok(());
            }

            let protocol_fee_base_amount: u64 = safe_mul_div_cast_u64(
                base_migration_amount,
                PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into(),
                BASIS_POINT_MAX,
                Rounding::Down,
            ).unwrap();

            let (computed_protocol_base_fee_amount, _protocol_fee_quote_amount) = get_protocol_liquidity_fee_tokens(
                quote_amount,
                sqrt_price,
                PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
            ).unwrap();

            assert!(computed_protocol_base_fee_amount <= protocol_fee_base_amount);
        }
    }

    proptest! {
        #[test]
        fn test_protocol_fee_rounding_avoid_price_increment(
            quote_amount in 10_000_000_000_000u64..u64::MAX,
            sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
        ) {
            let price_0 = U256::from(sqrt_price)
                .safe_mul(U256::from(sqrt_price))
                .unwrap();

            let (base_migration_amount, rem) =
                    U256::from(quote_amount).safe_shl(128).unwrap().div_rem(price_0);

            let mut base_migration_amount: u64 = base_migration_amount.try_into().unwrap();

            if !rem.is_zero() {
                base_migration_amount = base_migration_amount.safe_add(1).unwrap();
            }

            if base_migration_amount == 0 {
                return Ok(());
            }

            let price_0 = U256::from(quote_amount)
                .safe_shl(128).unwrap()
                .safe_div(U256::from(base_migration_amount)).unwrap();

            let (protocol_fee_base_amount, protocol_fee_quote_amount) = get_protocol_liquidity_fee_tokens(
                quote_amount,
                sqrt_price,
                PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
            ).unwrap();

            let excluded_fee_base_amount = base_migration_amount.safe_sub(protocol_fee_base_amount).unwrap();
            let excluded_fee_quote_amount = quote_amount.safe_sub(protocol_fee_quote_amount).unwrap();

            let price_1 = U256::from(excluded_fee_quote_amount)
                .safe_shl(128).unwrap()
                .safe_div(U256::from(excluded_fee_base_amount)).unwrap();

            assert!(price_1 <= price_0);

            // let price_0_float = quote_amount as f64 / base_migration_amount as f64;
            // let price_1_float = excluded_fee_quote_amount as f64 / excluded_fee_base_amount as f64;
            // assert!(price_1_float <= price_0_float);
        }
    }
}
