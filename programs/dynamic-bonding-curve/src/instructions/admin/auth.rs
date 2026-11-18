use anchor_lang::prelude::*;

pub mod admin {
    use anchor_lang::prelude::*;

    // https://app.squads.so/squads/3YyYuJDv6nxq94DLioHnh6dizBDy5vjhnbipUTNU4z6r/members
    #[cfg(not(feature = "devnet"))]
    pub const ADMIN: Pubkey = pubkey!("3YyYuJDv6nxq94DLioHnh6dizBDy5vjhnbipUTNU4z6r");

    #[cfg(feature = "devnet")]
    pub const ADMIN: Pubkey = pubkey!("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX");
}

pub mod treasury {
    use anchor_lang::prelude::*;

    // https://app.squads.so/squads/6aYhxiNGmG8AyU25rh2R7iFu4pBrqnQHpNUGhmsEXRcm/treasury
    pub const ID: Pubkey = pubkey!("6aYhxiNGmG8AyU25rh2R7iFu4pBrqnQHpNUGhmsEXRcm");
}

#[cfg(feature = "local")]
pub fn assert_eq_admin(_admin: Pubkey) -> bool {
    true
}

#[cfg(not(feature = "local"))]
pub fn assert_eq_admin(admin: Pubkey) -> bool {
    admin.eq(&crate::admin::admin::ADMIN)
}
