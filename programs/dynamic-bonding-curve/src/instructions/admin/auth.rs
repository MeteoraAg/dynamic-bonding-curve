use anchor_lang::prelude::*;

pub mod admin {
    use anchor_lang::{prelude::Pubkey, solana_program::pubkey};

    pub const ADMINS: [Pubkey; 2] = [
        pubkey!("5unTfT2kssBuNvHPY6LbJfJpLqEcdMxGYLWHwShaeTLi"),
        pubkey!("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX"),
    ];
}

pub mod treasury {
    use anchor_lang::{prelude::Pubkey, solana_program::pubkey};

    // https://app.squads.so/squads/6aYhxiNGmG8AyU25rh2R7iFu4pBrqnQHpNUGhmsEXRcm/treasury
    pub const ID: Pubkey = pubkey!("6aYhxiNGmG8AyU25rh2R7iFu4pBrqnQHpNUGhmsEXRcm");
}

#[cfg(feature = "local")]
pub fn assert_eq_admin(_admin: Pubkey) -> bool {
    true
}

#[cfg(not(feature = "local"))]
pub fn assert_eq_admin(admin: Pubkey) -> bool {
    crate::admin::admin::ADMINS
        .iter()
        .any(|predefined_admin| predefined_admin.eq(&admin))
}
