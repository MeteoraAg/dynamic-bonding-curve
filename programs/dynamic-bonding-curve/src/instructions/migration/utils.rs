use crate::constants::fee::{FEE_TIER_0_LAMPORT, FEE_TIER_0_MINT, FEE_TIER_1_LAMPORT};
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, system_instruction},
    system_program::{transfer, Transfer},
};

pub fn flash_rent<'info, F: Fn() -> Result<()>>(
    lender_ai: AccountInfo<'info>,
    borrower_ai: AccountInfo<'info>,
    system_program_ai: AccountInfo<'info>,
    op: F,
) -> Result<()> {
    // Someone have to fund 1 SOL for pool authority for flash rent
    let before_lamports = lender_ai.lamports();
    op()?;
    let after_lamports = lender_ai.lamports();
    let consumed_lamports = before_lamports.saturating_sub(after_lamports);

    if consumed_lamports > 0 {
        let transfer_ix =
            system_instruction::transfer(&borrower_ai.key(), &lender_ai.key(), consumed_lamports);
        let accounts = &[borrower_ai, lender_ai, system_program_ai];
        invoke(&transfer_ix, accounts)?;
    }
    Ok(())
}

pub fn charge_migration_fee<'info>(
    payer: AccountInfo<'info>,
    pool_authority: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    quote_mint_pubkey: Pubkey,
) -> Result<()> {
    let fee_amount = if FEE_TIER_0_MINT
        .iter()
        .any(|mint| mint.eq(&quote_mint_pubkey))
    {
        FEE_TIER_0_LAMPORT
    } else {
        FEE_TIER_1_LAMPORT
    };
    let cpi_context = CpiContext::new(
        system_program,
        Transfer {
            from: payer,
            to: pool_authority,
        },
    );
    transfer(cpi_context, fee_amount)
}
