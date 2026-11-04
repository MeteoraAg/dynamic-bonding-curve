use crate::*;

/// Metadata for a virtual pool.
#[account]
#[derive(Debug, Default)]
pub struct VirtualPoolMetadata {
    /// virtual pool
    pub virtual_pool: Pubkey,
    /// padding for future use
    pub padding: [u128; 6],
    /// Name of project.
    pub name: String,
    /// Website of project.
    pub website: String,
    /// Logo of project
    pub logo: String,
}

impl VirtualPoolMetadata {
    /// Space that a [PartnerMetadata] takes up.
    pub fn space(metadata: &CreateVirtualPoolMetadataParameters) -> usize {
        std::mem::size_of::<Pubkey>()
            + 16 * 6
            + 4
            + metadata.name.len()
            + 4
            + metadata.website.len()
            + 4
            + metadata.logo.len()
    }
}
