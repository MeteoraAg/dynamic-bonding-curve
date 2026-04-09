use crate::constants::seeds::PARTNER_METADATA_PREFIX;
use crate::state::PartnerMetadata;
use crate::event::EvtPartnerMetadata;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreatePartnerMetadataParameters {
    // padding for future use
    pub padding: [u8; 96],
    pub name: String,
    pub website: String,
    pub logo: String,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(metadata: CreatePartnerMetadataParameters)]
pub struct CreatePartnerMetadataCtx<'info> {
    /// Partner metadata
    #[account(
        init,
        seeds = [
            PARTNER_METADATA_PREFIX.as_ref(),
            fee_claimer.key().as_ref()
        ],
        bump,
        payer = payer,
        space = 8 + PartnerMetadata::space(&metadata)
    )]
    pub partner_metadata: Box<Account<'info, PartnerMetadata>>,
    /// Payer of the partner metadata.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Fee claimer for partner
    pub fee_claimer: Signer<'info>,
    /// System program.
    pub system_program: Program<'info, System>,
}

pub fn handle_create_partner_metadata(
    ctx: Context<CreatePartnerMetadataCtx>,
    metadata: CreatePartnerMetadataParameters,
) -> Result<()> {
    let partner_metadata = &mut ctx.accounts.partner_metadata;
    partner_metadata.fee_claimer = ctx.accounts.fee_claimer.key();
    partner_metadata.name = metadata.name;
    partner_metadata.website = metadata.website;
    partner_metadata.logo = metadata.logo;
    emit_cpi!(EvtPartnerMetadata {
        partner_metadata: ctx.accounts.partner_metadata.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
    });
    Ok(())
}
