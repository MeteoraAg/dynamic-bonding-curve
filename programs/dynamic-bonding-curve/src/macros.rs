//! Macro functions
macro_rules! pool_authority_seeds {
    ($bump:expr) => {
        &[b"pool_authority".as_ref(), &[$bump]]
    };
}

macro_rules! base_locker_seeds {
    ($virtual_pool:expr, $bump:expr) => {
        &[b"base_locker".as_ref(), $virtual_pool.as_ref(), &[$bump]]
    };
}
