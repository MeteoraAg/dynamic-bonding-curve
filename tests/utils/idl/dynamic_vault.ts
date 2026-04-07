/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/dynamic_vault.json`.
 */
export type DynamicVault = {
  "address": "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi",
  "metadata": {
    "name": "dynamicVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "Program for vault"
  ],
  "instructions": [
    {
      "name": "initialize",
      "docs": [
        "initialize new vault"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "vault",
          "docs": [
            "This is base account for all vault",
            "No need base key now because we only allow 1 vault per token now",
            "Vault account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "const",
                "value": [
                  245,
                  105,
                  223,
                  222,
                  32,
                  35,
                  51,
                  89,
                  141,
                  199,
                  215,
                  75,
                  29,
                  148,
                  184,
                  98,
                  71,
                  121,
                  193,
                  248,
                  47,
                  30,
                  37,
                  166,
                  91,
                  110,
                  78,
                  248,
                  163,
                  190,
                  155,
                  155
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Payer can be anyone"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint account"
          ]
        },
        {
          "name": "lpMint",
          "docs": [
            "LP mint account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "rent",
          "docs": [
            "rent"
          ],
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "tokenProgram"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "systemProgram"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "types": [
    {
      "name": "lockedProfitTracker",
      "docs": [
        "LockedProfitTracker struct"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastUpdatedLockedProfit",
            "docs": [
              "The total locked profit from the last report"
            ],
            "type": "u64"
          },
          {
            "name": "lastReport",
            "docs": [
              "The last timestamp (in seconds) rebalancing"
            ],
            "type": "u64"
          },
          {
            "name": "lockedProfitDegradation",
            "docs": [
              "Rate per second of degradation"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "Vault struct"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "docs": [
              "The flag, if admin set enable = false, then the user can only withdraw and cannot deposit in the vault."
            ],
            "type": "u8"
          },
          {
            "name": "bumps",
            "docs": [
              "Vault nonce, to create vault seeds"
            ],
            "type": {
              "defined": {
                "name": "vaultBumps"
              }
            }
          },
          {
            "name": "totalAmount",
            "docs": [
              "The total liquidity of the vault, including remaining tokens in token_vault and the liquidity in all strategies."
            ],
            "type": "u64"
          },
          {
            "name": "tokenVault",
            "docs": [
              "Token account, hold liquidity in vault reserve"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeVault",
            "docs": [
              "Hold lp token of vault, each time rebalance crank is called, vault calculate performance fee and mint corresponding lp token amount to fee_vault. fee_vault is owned by treasury address"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "Token mint that vault supports"
            ],
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "docs": [
              "Lp mint of vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "strategies",
            "docs": [
              "The list of strategy addresses that vault supports, vault can support up to MAX_STRATEGY strategies at the same time."
            ],
            "type": {
              "array": [
                "pubkey",
                30
              ]
            }
          },
          {
            "name": "base",
            "docs": [
              "The base address to create vault seeds"
            ],
            "type": "pubkey"
          },
          {
            "name": "admin",
            "docs": [
              "Admin of vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "operator",
            "docs": [
              "Person who can send the crank. Operator can only send liquidity to strategies that admin defined, and claim reward to account of treasury address"
            ],
            "type": "pubkey"
          },
          {
            "name": "lockedProfitTracker",
            "docs": [
              "Stores information for locked profit."
            ],
            "type": {
              "defined": {
                "name": "lockedProfitTracker"
              }
            }
          }
        ]
      }
    },
    {
      "name": "vaultBumps",
      "docs": [
        "Vault bumps struct"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultBump",
            "docs": [
              "vaultBump"
            ],
            "type": "u8"
          },
          {
            "name": "tokenVaultBump",
            "docs": [
              "tokenVaultBump"
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
