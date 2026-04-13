use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use std::convert::TryFrom;

use crate::PoolError;

#[derive(
    Copy,
    Clone,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    IntoPrimitive,
    TryFromPrimitive,
)]
#[repr(u8)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

pub fn get_current_point(activation_type: u8) -> Result<u64> {
    let activation_type =
        ActivationType::try_from(activation_type).map_err(|_| PoolError::InvalidActivationType)?;
    let current_point = match activation_type {
        ActivationType::Slot => Clock::get()?.slot,
        ActivationType::Timestamp => Clock::get()?.unix_timestamp as u64,
    };
    Ok(current_point)
}
