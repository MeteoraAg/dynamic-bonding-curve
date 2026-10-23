#[cfg(feature = "idl-build")]
use anchor_lang::idl::types::{IdlType, IdlTypeDef, IdlTypeDefTy};
use anchor_lang::prelude::*;
#[cfg(feature = "idl-build")]
use std::collections::BTreeMap;

use crate::remaining_accounts::TransferHookAccountsInfo;

#[derive(Debug, Clone, Default)]
pub struct OptionalTransferHookAccountsInfo(pub Option<TransferHookAccountsInfo>);

impl AnchorSerialize for OptionalTransferHookAccountsInfo {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        self.0.serialize(writer)
    }
}

// When there is no TransferHookAccountsInfo (0 byte) -> Ok(None). Otherwise handler is identical to Option<TransferHookAccountsInfo>
// reference https://github.com/near/borsh-rs/blob/borsh-v1.6.1/borsh/src/de/mod.rs#L316-L336
impl AnchorDeserialize for OptionalTransferHookAccountsInfo {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let mut buf = [0u8; 1];
        if reader.read(&mut buf)? == 0 {
            // reader reads 0 bytes. backwards compatible for when caller doesn't pass any argument.
            return Ok(Self(None));
        }
        let flag = buf[0];
        if flag == 0 {
            // argument is None
            Ok(Self(None))
        } else if flag == 1 {
            Ok(Self(Some(TransferHookAccountsInfo::deserialize_reader(
                reader,
            )?)))
        } else {
            let msg = format!(
                "Invalid Option representation: {}. The first byte must be 0 or 1",
                flag
            );

            Err(std::io::Error::new(std::io::ErrorKind::InvalidData, msg))
        }
    }
}

// Describes this type in the IDL so clients encode the argument the same way as `Option<TransferHookAccountsInfo>`
#[cfg(feature = "idl-build")]
impl anchor_lang::idl::build::IdlBuild for OptionalTransferHookAccountsInfo {
    // Adds an IDL entry that is an alias of `Option<TransferHookAccountsInfo>`:
    // { "name": "OptionalTransferHookAccountsInfo", "type": { "kind": "type", "alias": { "option": { "defined": { "name": "TransferHookAccountsInfo" } } } } }
    fn create_type() -> Option<IdlTypeDef> {
        Some(IdlTypeDef {
            name: Self::get_full_path(),
            docs: vec![],
            serialization: Default::default(),
            repr: None,
            generics: vec![],
            ty: IdlTypeDefTy::Type {
                alias: IdlType::Option(Box::new(IdlType::Defined {
                    name: TransferHookAccountsInfo::get_full_path(),
                    generics: vec![],
                })),
            },
        })
    }

    fn insert_types(types: &mut BTreeMap<String, IdlTypeDef>) {
        if let Some(ty) = TransferHookAccountsInfo::create_type() {
            types.insert(TransferHookAccountsInfo::get_full_path(), ty);
            TransferHookAccountsInfo::insert_types(types);
        }
    }

    fn get_full_path() -> String {
        format!("{}::{}", module_path!(), "OptionalTransferHookAccountsInfo")
    }
}
