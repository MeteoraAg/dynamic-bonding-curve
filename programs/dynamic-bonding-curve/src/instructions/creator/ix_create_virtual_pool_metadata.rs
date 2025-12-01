use crate::constants::seeds::VIRTUAL_POOL_METADATA_PREFIX;
use crate::state::{VirtualPool, VirtualPoolMetadata};
use crate::EvtVirtualPoolMetadata;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateVirtualPoolMetadataParameters {
    // padding for future use
    pub padding: [u8; 96],
    pub name: String,
    pub website: String,
    pub logo: String,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(metadata: CreateVirtualPoolMetadataParameters)]
pub struct CreateVirtualPoolMetadataCtx<'info> {
    #[account(mut)]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,
    /// Virtual pool metadata
    #[account(
        init,
        seeds = [
            VIRTUAL_POOL_METADATA_PREFIX.as_ref(),
            virtual_pool.key().as_ref()
        ],
        bump,
        payer = payer,
        space = 8 + VirtualPoolMetadata::space(&metadata)
    )]
    pub virtual_pool_metadata: Box<Account<'info, VirtualPoolMetadata>>,

    pub creator: Signer<'info>,

    /// Payer of the virtual pool metadata.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program.
    pub system_program: Program<'info, System>,
}

pub fn handle_create_virtual_pool_metadata(
    ctx: Context<CreateVirtualPoolMetadataCtx>,
    metadata: CreateVirtualPoolMetadataParameters,
) -> Result<()> {
    let virtual_pool_metadata = &mut ctx.accounts.virtual_pool_metadata;
    virtual_pool_metadata.virtual_pool = ctx.accounts.virtual_pool.key();
    virtual_pool_metadata.name = metadata.name;
    virtual_pool_metadata.website = metadata.website;
    virtual_pool_metadata.logo = metadata.logo;
    emit_cpi!(EvtVirtualPoolMetadata {
        virtual_pool_metadata: ctx.accounts.virtual_pool_metadata.key(),
        virtual_pool: ctx.accounts.virtual_pool.key(),
    });
    Ok(())
}
