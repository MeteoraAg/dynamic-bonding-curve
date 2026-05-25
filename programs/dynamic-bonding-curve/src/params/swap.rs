use num_enum::{IntoPrimitive, TryFromPrimitive};

/// Trade (swap) direction
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum TradeDirection {
    /// Input base token, output quote token
    BaseToQuote,
    /// Input quote token, output base token
    QuoteToBase,
}
