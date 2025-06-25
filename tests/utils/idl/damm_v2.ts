/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cp_amm.json`.
 */
export type CpAmm = {
  "address": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  "metadata": {
    "name": "cpAmm",
    "version": "0.1.1",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addLiquidity",
      "discriminator": [
        181,
        157,
        89,
        67,
        143,
        182,
        52,
        72
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The user token a account"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The user token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "addLiquidityParameters"
            }
          }
        }
      ]
    },
    {
      "name": "claimPartnerFee",
      "discriminator": [
        97,
        206,
        39,
        105,
        94,
        94,
        126,
        148
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The treasury token a account"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The treasury token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "partner",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "maxAmountA",
          "type": "u64"
        },
        {
          "name": "maxAmountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPositionFee",
      "discriminator": [
        180,
        38,
        154,
        17,
        133,
        33,
        162,
        211
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The user token a account"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The user token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "claimProtocolFee",
      "discriminator": [
        165,
        228,
        133,
        48,
        99,
        249,
        255,
        33
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The treasury token a account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  48,
                  9,
                  89,
                  123,
                  106,
                  114,
                  131,
                  251,
                  50,
                  173,
                  254,
                  250,
                  10,
                  80,
                  160,
                  84,
                  143,
                  100,
                  81,
                  249,
                  134,
                  112,
                  30,
                  213,
                  50,
                  166,
                  239,
                  78,
                  53,
                  175,
                  188,
                  85
                ]
              },
              {
                "kind": "account",
                "path": "tokenAProgram"
              },
              {
                "kind": "account",
                "path": "tokenAMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The treasury token b account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  48,
                  9,
                  89,
                  123,
                  106,
                  114,
                  131,
                  251,
                  50,
                  173,
                  254,
                  250,
                  10,
                  80,
                  160,
                  84,
                  143,
                  100,
                  81,
                  249,
                  134,
                  112,
                  30,
                  213,
                  50,
                  166,
                  239,
                  78,
                  53,
                  175,
                  188,
                  85
                ]
              },
              {
                "kind": "account",
                "path": "tokenBProgram"
              },
              {
                "kind": "account",
                "path": "tokenBMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "claimFeeOperator",
          "docs": [
            "Claim fee operator"
          ]
        },
        {
          "name": "operator",
          "docs": [
            "Operator"
          ],
          "signer": true,
          "relations": [
            "claimFeeOperator"
          ]
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "claimReward",
      "discriminator": [
        149,
        95,
        181,
        242,
        94,
        90,
        158,
        162
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "rewardVault",
          "docs": [
            "The vault token account for reward token"
          ],
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "closeClaimFeeOperator",
      "discriminator": [
        38,
        134,
        82,
        216,
        95,
        124,
        17,
        99
      ],
      "accounts": [
        {
          "name": "claimFeeOperator",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "closeConfig",
      "discriminator": [
        145,
        9,
        72,
        157,
        95,
        125,
        61,
        85
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "closePosition",
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "positionNftMint",
          "docs": [
            "positionNftMint"
          ],
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ],
          "writable": true
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "owner",
          "docs": [
            "Owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Program to create NFT mint/token account and transfer for token22 account"
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "createClaimFeeOperator",
      "discriminator": [
        169,
        62,
        207,
        107,
        58,
        187,
        162,
        109
      ],
      "accounts": [
        {
          "name": "claimFeeOperator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  95,
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "operator"
              }
            ]
          }
        },
        {
          "name": "operator"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "createConfig",
      "docs": [
        "ADMIN FUNCTIONS /////"
      ],
      "discriminator": [
        201,
        207,
        243,
        114,
        75,
        111,
        47,
        189
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "configParameters",
          "type": {
            "defined": {
              "name": "staticConfigParameters"
            }
          }
        }
      ]
    },
    {
      "name": "createDynamicConfig",
      "discriminator": [
        81,
        251,
        122,
        78,
        66,
        57,
        208,
        82
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "configParameters",
          "type": {
            "defined": {
              "name": "dynamicConfigParameters"
            }
          }
        }
      ]
    },
    {
      "name": "createPosition",
      "discriminator": [
        48,
        215,
        197,
        153,
        96,
        203,
        180,
        133
      ],
      "accounts": [
        {
          "name": "owner"
        },
        {
          "name": "positionNftMint",
          "docs": [
            "positionNftMint"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "position nft account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  110,
                  102,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Address paying to create the position. Can be anyone"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Program to create NFT mint/token account and transfer for token22 account"
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "createTokenBadge",
      "discriminator": [
        88,
        206,
        0,
        91,
        60,
        175,
        151,
        118
      ],
      "accounts": [
        {
          "name": "tokenBadge",
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
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "fundReward",
      "discriminator": [
        188,
        50,
        249,
        165,
        93,
        151,
        38,
        63
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "funderTokenAccount",
          "writable": true
        },
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "carryForward",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeCustomizablePool",
      "discriminator": [
        20,
        161,
        241,
        24,
        189,
        221,
        180,
        2
      ],
      "accounts": [
        {
          "name": "creator"
        },
        {
          "name": "positionNftMint",
          "docs": [
            "positionNftMint"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "position nft account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  110,
                  102,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Address paying to create the pool. Can be anyone"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "Initialize an account to store the pool state"
          ],
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "tokenAMint",
          "docs": [
            "Token a mint"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "Token b mint"
          ]
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Token a vault for the pool"
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
                "path": "tokenAMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Token b vault for the pool"
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
                "path": "tokenBMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "payerTokenA",
          "docs": [
            "payer token a account"
          ],
          "writable": true
        },
        {
          "name": "payerTokenB",
          "docs": [
            "creator token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "token2022Program",
          "docs": [
            "Program to create NFT mint/token account and transfer for token22 account"
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeCustomizablePoolParameters"
            }
          }
        }
      ]
    },
    {
      "name": "initializePool",
      "docs": [
        "USER FUNCTIONS ////"
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "creator"
        },
        {
          "name": "positionNftMint",
          "docs": [
            "positionNftMint"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "position nft account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  110,
                  102,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Address paying to create the pool. Can be anyone"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Which config the pool belongs to."
          ]
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "Initialize an account to store the pool state"
          ],
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "tokenAMint",
          "docs": [
            "Token a mint"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "Token b mint"
          ]
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Token a vault for the pool"
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
                "path": "tokenAMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Token b vault for the pool"
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
                "path": "tokenBMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "payerTokenA",
          "docs": [
            "payer token a account"
          ],
          "writable": true
        },
        {
          "name": "payerTokenB",
          "docs": [
            "creator token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "token2022Program",
          "docs": [
            "Program to create NFT mint/token account and transfer for token22 account"
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializePoolParameters"
            }
          }
        }
      ]
    },
    {
      "name": "initializePoolWithDynamicConfig",
      "discriminator": [
        149,
        82,
        72,
        197,
        253,
        252,
        68,
        15
      ],
      "accounts": [
        {
          "name": "creator"
        },
        {
          "name": "positionNftMint",
          "docs": [
            "positionNftMint"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "position nft account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  110,
                  102,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "payer",
          "docs": [
            "Address paying to create the pool. Can be anyone"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "poolCreatorAuthority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "docs": [
            "Which config the pool belongs to."
          ]
        },
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "Initialize an account to store the pool state"
          ],
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "positionNftMint"
              }
            ]
          }
        },
        {
          "name": "tokenAMint",
          "docs": [
            "Token a mint"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "Token b mint"
          ]
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Token a vault for the pool"
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
                "path": "tokenAMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Token b vault for the pool"
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
                "path": "tokenBMint"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "payerTokenA",
          "docs": [
            "payer token a account"
          ],
          "writable": true
        },
        {
          "name": "payerTokenB",
          "docs": [
            "creator token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Program to create mint account and mint tokens"
          ]
        },
        {
          "name": "token2022Program",
          "docs": [
            "Program to create NFT mint/token account and transfer for token22 account"
          ],
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeCustomizablePoolParameters"
            }
          }
        }
      ]
    },
    {
      "name": "initializeReward",
      "discriminator": [
        95,
        135,
        192,
        196,
        242,
        129,
        230,
        68
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
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
                "path": "pool"
              },
              {
                "kind": "arg",
                "path": "rewardIndex"
              }
            ]
          }
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "rewardDuration",
          "type": "u64"
        },
        {
          "name": "funder",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "lockPosition",
      "discriminator": [
        227,
        62,
        2,
        252,
        247,
        10,
        171,
        185
      ],
      "accounts": [
        {
          "name": "pool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "vesting",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "vestingParameters"
            }
          }
        }
      ]
    },
    {
      "name": "permanentLockPosition",
      "discriminator": [
        165,
        176,
        125,
        6,
        231,
        171,
        186,
        213
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "permanentLockLiquidity",
          "type": "u128"
        }
      ]
    },
    {
      "name": "refreshVesting",
      "discriminator": [
        9,
        94,
        216,
        14,
        116,
        204,
        247,
        0
      ],
      "accounts": [
        {
          "name": "pool",
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner"
        }
      ],
      "args": []
    },
    {
      "name": "removeAllLiquidity",
      "discriminator": [
        10,
        51,
        61,
        35,
        112,
        105,
        24,
        85
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The user token a account"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The user token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "tokenAAmountThreshold",
          "type": "u64"
        },
        {
          "name": "tokenBAmountThreshold",
          "type": "u64"
        }
      ]
    },
    {
      "name": "removeLiquidity",
      "discriminator": [
        80,
        85,
        209,
        72,
        24,
        206,
        177,
        108
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "The user token a account"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "The user token b account"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ],
          "relations": [
            "pool"
          ]
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "The token account for nft"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "owner of position"
          ],
          "signer": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "removeLiquidityParameters"
            }
          }
        }
      ]
    },
    {
      "name": "setPoolStatus",
      "discriminator": [
        112,
        87,
        135,
        223,
        83,
        204,
        132,
        53
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "status",
          "type": "u8"
        }
      ]
    },
    {
      "name": "swap",
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "Pool account"
          ],
          "writable": true
        },
        {
          "name": "inputTokenAccount",
          "docs": [
            "The user token account for input token"
          ],
          "writable": true
        },
        {
          "name": "outputTokenAccount",
          "docs": [
            "The user token account for output token"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "The vault token account for input token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenBVault",
          "docs": [
            "The vault token account for output token"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenAMint",
          "docs": [
            "The mint of token a"
          ]
        },
        {
          "name": "tokenBMint",
          "docs": [
            "The mint of token b"
          ]
        },
        {
          "name": "payer",
          "docs": [
            "The user performing the swap"
          ],
          "signer": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token a program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token b program"
          ]
        },
        {
          "name": "referralTokenAccount",
          "docs": [
            "referral token account"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "swapParameters"
            }
          }
        }
      ]
    },
    {
      "name": "updateRewardDuration",
      "discriminator": [
        138,
        174,
        196,
        169,
        213,
        235,
        254,
        107
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "newDuration",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateRewardFunder",
      "discriminator": [
        211,
        28,
        48,
        32,
        215,
        160,
        35,
        23
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        },
        {
          "name": "newFunder",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawIneligibleReward",
      "discriminator": [
        148,
        206,
        42,
        195,
        247,
        49,
        103,
        8
      ],
      "accounts": [
        {
          "name": "poolAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "rewardVault",
          "writable": true
        },
        {
          "name": "rewardMint"
        },
        {
          "name": "funderTokenAccount",
          "writable": true
        },
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "rewardIndex",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "claimFeeOperator",
      "discriminator": [
        166,
        48,
        134,
        86,
        34,
        200,
        188,
        150
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "tokenBadge",
      "discriminator": [
        116,
        219,
        204,
        229,
        249,
        116,
        255,
        150
      ]
    },
    {
      "name": "vesting",
      "discriminator": [
        100,
        149,
        66,
        138,
        95,
        200,
        128,
        241
      ]
    }
  ],
  "events": [
    {
      "name": "evtAddLiquidity",
      "discriminator": [
        175,
        242,
        8,
        157,
        30,
        247,
        185,
        169
      ]
    },
    {
      "name": "evtClaimPartnerFee",
      "discriminator": [
        118,
        99,
        77,
        10,
        226,
        1,
        1,
        87
      ]
    },
    {
      "name": "evtClaimPositionFee",
      "discriminator": [
        198,
        182,
        183,
        52,
        97,
        12,
        49,
        56
      ]
    },
    {
      "name": "evtClaimProtocolFee",
      "discriminator": [
        186,
        244,
        75,
        251,
        188,
        13,
        25,
        33
      ]
    },
    {
      "name": "evtClaimReward",
      "discriminator": [
        218,
        86,
        147,
        200,
        235,
        188,
        215,
        231
      ]
    },
    {
      "name": "evtCloseClaimFeeOperator",
      "discriminator": [
        111,
        39,
        37,
        55,
        110,
        216,
        194,
        23
      ]
    },
    {
      "name": "evtCloseConfig",
      "discriminator": [
        36,
        30,
        239,
        45,
        58,
        132,
        14,
        5
      ]
    },
    {
      "name": "evtClosePosition",
      "discriminator": [
        20,
        145,
        144,
        68,
        143,
        142,
        214,
        178
      ]
    },
    {
      "name": "evtCreateClaimFeeOperator",
      "discriminator": [
        21,
        6,
        153,
        120,
        68,
        116,
        28,
        177
      ]
    },
    {
      "name": "evtCreateConfig",
      "discriminator": [
        131,
        207,
        180,
        174,
        180,
        73,
        165,
        54
      ]
    },
    {
      "name": "evtCreateDynamicConfig",
      "discriminator": [
        231,
        197,
        13,
        164,
        248,
        213,
        133,
        152
      ]
    },
    {
      "name": "evtCreatePosition",
      "discriminator": [
        156,
        15,
        119,
        198,
        29,
        181,
        221,
        55
      ]
    },
    {
      "name": "evtCreateTokenBadge",
      "discriminator": [
        141,
        120,
        134,
        116,
        34,
        28,
        114,
        160
      ]
    },
    {
      "name": "evtFundReward",
      "discriminator": [
        104,
        233,
        237,
        122,
        199,
        191,
        121,
        85
      ]
    },
    {
      "name": "evtInitializePool",
      "discriminator": [
        228,
        50,
        246,
        85,
        203,
        66,
        134,
        37
      ]
    },
    {
      "name": "evtInitializeReward",
      "discriminator": [
        129,
        91,
        188,
        3,
        246,
        52,
        185,
        249
      ]
    },
    {
      "name": "evtLockPosition",
      "discriminator": [
        168,
        63,
        108,
        83,
        219,
        82,
        2,
        200
      ]
    },
    {
      "name": "evtPermanentLockPosition",
      "discriminator": [
        145,
        143,
        162,
        218,
        218,
        80,
        67,
        11
      ]
    },
    {
      "name": "evtRemoveLiquidity",
      "discriminator": [
        87,
        46,
        88,
        98,
        175,
        96,
        34,
        91
      ]
    },
    {
      "name": "evtSetPoolStatus",
      "discriminator": [
        100,
        213,
        74,
        3,
        95,
        91,
        228,
        146
      ]
    },
    {
      "name": "evtSwap",
      "discriminator": [
        27,
        60,
        21,
        213,
        138,
        170,
        187,
        147
      ]
    },
    {
      "name": "evtUpdateRewardDuration",
      "discriminator": [
        149,
        135,
        65,
        231,
        129,
        153,
        65,
        57
      ]
    },
    {
      "name": "evtUpdateRewardFunder",
      "discriminator": [
        76,
        154,
        208,
        13,
        40,
        115,
        246,
        146
      ]
    },
    {
      "name": "evtWithdrawIneligibleReward",
      "discriminator": [
        248,
        215,
        184,
        78,
        31,
        180,
        179,
        168
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Math operation overflow"
    },
    {
      "code": 6001,
      "name": "invalidFee",
      "msg": "Invalid fee setup"
    },
    {
      "code": 6002,
      "name": "exceededSlippage",
      "msg": "Exceeded slippage tolerance"
    },
    {
      "code": 6003,
      "name": "poolDisabled",
      "msg": "Pool disabled"
    },
    {
      "code": 6004,
      "name": "exceedMaxFeeBps",
      "msg": "Exceeded max fee bps"
    },
    {
      "code": 6005,
      "name": "invalidAdmin",
      "msg": "Invalid admin"
    },
    {
      "code": 6006,
      "name": "amountIsZero",
      "msg": "Amount is zero"
    },
    {
      "code": 6007,
      "name": "typeCastFailed",
      "msg": "Type cast error"
    },
    {
      "code": 6008,
      "name": "unableToModifyActivationPoint",
      "msg": "Unable to modify activation point"
    },
    {
      "code": 6009,
      "name": "invalidAuthorityToCreateThePool",
      "msg": "Invalid authority to create the pool"
    },
    {
      "code": 6010,
      "name": "invalidActivationType",
      "msg": "Invalid activation type"
    },
    {
      "code": 6011,
      "name": "invalidActivationPoint",
      "msg": "Invalid activation point"
    },
    {
      "code": 6012,
      "name": "invalidQuoteMint",
      "msg": "Quote token must be SOL,USDC"
    },
    {
      "code": 6013,
      "name": "invalidFeeCurve",
      "msg": "Invalid fee curve"
    },
    {
      "code": 6014,
      "name": "invalidPriceRange",
      "msg": "Invalid Price Range"
    },
    {
      "code": 6015,
      "name": "priceRangeViolation",
      "msg": "Trade is over price range"
    },
    {
      "code": 6016,
      "name": "invalidParameters",
      "msg": "Invalid parameters"
    },
    {
      "code": 6017,
      "name": "invalidCollectFeeMode",
      "msg": "Invalid collect fee mode"
    },
    {
      "code": 6018,
      "name": "invalidInput",
      "msg": "Invalid input"
    },
    {
      "code": 6019,
      "name": "cannotCreateTokenBadgeOnSupportedMint",
      "msg": "Cannot create token badge on supported mint"
    },
    {
      "code": 6020,
      "name": "invalidTokenBadge",
      "msg": "Invalid token badge"
    },
    {
      "code": 6021,
      "name": "invalidMinimumLiquidity",
      "msg": "Invalid minimum liquidity"
    },
    {
      "code": 6022,
      "name": "invalidVestingInfo",
      "msg": "Invalid vesting information"
    },
    {
      "code": 6023,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6024,
      "name": "invalidVestingAccount",
      "msg": "Invalid vesting account"
    },
    {
      "code": 6025,
      "name": "invalidPoolStatus",
      "msg": "Invalid pool status"
    },
    {
      "code": 6026,
      "name": "unsupportNativeMintToken2022",
      "msg": "Unsupported native mint token2022"
    },
    {
      "code": 6027,
      "name": "invalidRewardIndex",
      "msg": "Invalid reward index"
    },
    {
      "code": 6028,
      "name": "invalidRewardDuration",
      "msg": "Invalid reward duration"
    },
    {
      "code": 6029,
      "name": "rewardInitialized",
      "msg": "Reward already initialized"
    },
    {
      "code": 6030,
      "name": "rewardUninitialized",
      "msg": "Reward not initialized"
    },
    {
      "code": 6031,
      "name": "invalidRewardVault",
      "msg": "Invalid reward vault"
    },
    {
      "code": 6032,
      "name": "mustWithdrawnIneligibleReward",
      "msg": "Must withdraw ineligible reward"
    },
    {
      "code": 6033,
      "name": "identicalRewardDuration",
      "msg": "Reward duration is the same"
    },
    {
      "code": 6034,
      "name": "rewardCampaignInProgress",
      "msg": "Reward campaign in progress"
    },
    {
      "code": 6035,
      "name": "identicalFunder",
      "msg": "Identical funder"
    },
    {
      "code": 6036,
      "name": "invalidFunder",
      "msg": "Invalid funder"
    },
    {
      "code": 6037,
      "name": "rewardNotEnded",
      "msg": "Reward not ended"
    },
    {
      "code": 6038,
      "name": "feeInverseIsIncorrect",
      "msg": "Fee inverse is incorrect"
    },
    {
      "code": 6039,
      "name": "positionIsNotEmpty",
      "msg": "Position is not empty"
    },
    {
      "code": 6040,
      "name": "invalidPoolCreatorAuthority",
      "msg": "Invalid pool creator authority"
    },
    {
      "code": 6041,
      "name": "invalidConfigType",
      "msg": "Invalid config type"
    }
  ],
  "types": [
    {
      "name": "addLiquidityParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "liquidityDelta",
            "docs": [
              "delta liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "tokenAAmountThreshold",
            "docs": [
              "maximum token a amount"
            ],
            "type": "u64"
          },
          {
            "name": "tokenBAmountThreshold",
            "docs": [
              "maximum token b amount"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "baseFeeConfig",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cliffFeeNumerator",
            "type": "u64"
          },
          {
            "name": "feeSchedulerMode",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "reductionFactor",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "baseFeeParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cliffFeeNumerator",
            "type": "u64"
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "reductionFactor",
            "type": "u64"
          },
          {
            "name": "feeSchedulerMode",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "baseFeeStruct",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cliffFeeNumerator",
            "type": "u64"
          },
          {
            "name": "feeSchedulerMode",
            "type": "u8"
          },
          {
            "name": "padding0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "reductionFactor",
            "type": "u64"
          },
          {
            "name": "padding1",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimFeeOperator",
      "docs": [
        "Parameter that set by the protocol"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "operator",
            "docs": [
              "operator"
            ],
            "type": "pubkey"
          },
          {
            "name": "padding",
            "docs": [
              "Reserve"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultConfigKey",
            "docs": [
              "Vault config key"
            ],
            "type": "pubkey"
          },
          {
            "name": "poolCreatorAuthority",
            "docs": [
              "Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config."
            ],
            "type": "pubkey"
          },
          {
            "name": "poolFees",
            "docs": [
              "Pool fee"
            ],
            "type": {
              "defined": {
                "name": "poolFeesConfig"
              }
            }
          },
          {
            "name": "activationType",
            "docs": [
              "Activation type"
            ],
            "type": "u8"
          },
          {
            "name": "collectFeeMode",
            "docs": [
              "Collect fee mode"
            ],
            "type": "u8"
          },
          {
            "name": "configType",
            "docs": [
              "Config type mode, 0 for static, 1 for dynamic"
            ],
            "type": "u8"
          },
          {
            "name": "padding0",
            "docs": [
              "padding 0"
            ],
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "index",
            "docs": [
              "config index"
            ],
            "type": "u64"
          },
          {
            "name": "sqrtMinPrice",
            "docs": [
              "sqrt min price"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "docs": [
              "sqrt max price"
            ],
            "type": "u128"
          },
          {
            "name": "padding1",
            "docs": [
              "Fee curve point",
              "Padding for further use"
            ],
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          }
        ]
      }
    },
    {
      "name": "dynamicConfigParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolCreatorAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "dynamicFeeConfig",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "maxVolatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "variableFeeControl",
            "type": "u32"
          },
          {
            "name": "binStep",
            "type": "u16"
          },
          {
            "name": "filterPeriod",
            "type": "u16"
          },
          {
            "name": "decayPeriod",
            "type": "u16"
          },
          {
            "name": "reductionFactor",
            "type": "u16"
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "binStepU128",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "dynamicFeeParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "binStep",
            "type": "u16"
          },
          {
            "name": "binStepU128",
            "type": "u128"
          },
          {
            "name": "filterPeriod",
            "type": "u16"
          },
          {
            "name": "decayPeriod",
            "type": "u16"
          },
          {
            "name": "reductionFactor",
            "type": "u16"
          },
          {
            "name": "maxVolatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "variableFeeControl",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "dynamicFeeStruct",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "maxVolatilityAccumulator",
            "type": "u32"
          },
          {
            "name": "variableFeeControl",
            "type": "u32"
          },
          {
            "name": "binStep",
            "type": "u16"
          },
          {
            "name": "filterPeriod",
            "type": "u16"
          },
          {
            "name": "decayPeriod",
            "type": "u16"
          },
          {
            "name": "reductionFactor",
            "type": "u16"
          },
          {
            "name": "lastUpdateTimestamp",
            "type": "u64"
          },
          {
            "name": "binStepU128",
            "type": "u128"
          },
          {
            "name": "sqrtPriceReference",
            "type": "u128"
          },
          {
            "name": "volatilityAccumulator",
            "type": "u128"
          },
          {
            "name": "volatilityReference",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "evtAddLiquidity",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "addLiquidityParameters"
              }
            }
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          },
          {
            "name": "totalAmountA",
            "type": "u64"
          },
          {
            "name": "totalAmountB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtClaimPartnerFee",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtClaimPositionFee",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "feeAClaimed",
            "type": "u64"
          },
          {
            "name": "feeBClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtClaimProtocolFee",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtClaimReward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mintReward",
            "type": "pubkey"
          },
          {
            "name": "rewardIndex",
            "type": "u8"
          },
          {
            "name": "totalReward",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtCloseClaimFeeOperator",
      "docs": [
        "Close claim fee operator"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "claimFeeOperator",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtCloseConfig",
      "docs": [
        "Close config"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "docs": [
              "Config pubkey"
            ],
            "type": "pubkey"
          },
          {
            "name": "admin",
            "docs": [
              "admin pk"
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtClosePosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "positionNftMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtCreateClaimFeeOperator",
      "docs": [
        "Create claim fee operator"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "operator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtCreateConfig",
      "docs": [
        "Create static config"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolFees",
            "type": {
              "defined": {
                "name": "poolFeeParameters"
              }
            }
          },
          {
            "name": "vaultConfigKey",
            "type": "pubkey"
          },
          {
            "name": "poolCreatorAuthority",
            "type": "pubkey"
          },
          {
            "name": "activationType",
            "type": "u8"
          },
          {
            "name": "sqrtMinPrice",
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "type": "u128"
          },
          {
            "name": "collectFeeMode",
            "type": "u8"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "config",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtCreateDynamicConfig",
      "docs": [
        "Create dynamic config"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "poolCreatorAuthority",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtCreatePosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "positionNftMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtCreateTokenBadge",
      "docs": [
        "Create token badge"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtFundReward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "mintReward",
            "type": "pubkey"
          },
          {
            "name": "rewardIndex",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "transferFeeExcludedAmountIn",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtInitializePool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "tokenAMint",
            "type": "pubkey"
          },
          {
            "name": "tokenBMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "alphaVault",
            "type": "pubkey"
          },
          {
            "name": "poolFees",
            "type": {
              "defined": {
                "name": "poolFeeParameters"
              }
            }
          },
          {
            "name": "sqrtMinPrice",
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "type": "u128"
          },
          {
            "name": "activationType",
            "type": "u8"
          },
          {
            "name": "collectFeeMode",
            "type": "u8"
          },
          {
            "name": "liquidity",
            "type": "u128"
          },
          {
            "name": "sqrtPrice",
            "type": "u128"
          },
          {
            "name": "activationPoint",
            "type": "u64"
          },
          {
            "name": "tokenAFlag",
            "type": "u8"
          },
          {
            "name": "tokenBFlag",
            "type": "u8"
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          },
          {
            "name": "totalAmountA",
            "type": "u64"
          },
          {
            "name": "totalAmountB",
            "type": "u64"
          },
          {
            "name": "poolType",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "evtInitializeReward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "rewardIndex",
            "type": "u8"
          },
          {
            "name": "rewardDuration",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtLockPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vesting",
            "type": "pubkey"
          },
          {
            "name": "cliffPoint",
            "type": "u64"
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "cliffUnlockLiquidity",
            "type": "u128"
          },
          {
            "name": "liquidityPerPeriod",
            "type": "u128"
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "evtPermanentLockPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "lockLiquidityAmount",
            "type": "u128"
          },
          {
            "name": "totalPermanentLockedLiquidity",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "evtRemoveLiquidity",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "removeLiquidityParameters"
              }
            }
          },
          {
            "name": "tokenAAmount",
            "type": "u64"
          },
          {
            "name": "tokenBAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtSetPoolStatus",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "evtSwap",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "tradeDirection",
            "type": "u8"
          },
          {
            "name": "hasReferral",
            "type": "bool"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "swapParameters"
              }
            }
          },
          {
            "name": "swapResult",
            "type": {
              "defined": {
                "name": "swapResult"
              }
            }
          },
          {
            "name": "actualAmountIn",
            "type": "u64"
          },
          {
            "name": "currentTimestamp",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtUpdateRewardDuration",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "rewardIndex",
            "type": "u8"
          },
          {
            "name": "oldRewardDuration",
            "type": "u64"
          },
          {
            "name": "newRewardDuration",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "evtUpdateRewardFunder",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "rewardIndex",
            "type": "u8"
          },
          {
            "name": "oldFunder",
            "type": "pubkey"
          },
          {
            "name": "newFunder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "evtWithdrawIneligibleReward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "rewardMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initializeCustomizablePoolParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolFees",
            "docs": [
              "pool fees"
            ],
            "type": {
              "defined": {
                "name": "poolFeeParameters"
              }
            }
          },
          {
            "name": "sqrtMinPrice",
            "docs": [
              "sqrt min price"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "docs": [
              "sqrt max price"
            ],
            "type": "u128"
          },
          {
            "name": "hasAlphaVault",
            "docs": [
              "has alpha vault"
            ],
            "type": "bool"
          },
          {
            "name": "liquidity",
            "docs": [
              "initialize liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtPrice",
            "docs": [
              "The init price of the pool as a sqrt(token_b/token_a) Q64.64 value"
            ],
            "type": "u128"
          },
          {
            "name": "activationType",
            "docs": [
              "activation type"
            ],
            "type": "u8"
          },
          {
            "name": "collectFeeMode",
            "docs": [
              "collect fee mode"
            ],
            "type": "u8"
          },
          {
            "name": "activationPoint",
            "docs": [
              "activation point"
            ],
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "initializePoolParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "liquidity",
            "docs": [
              "initialize liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtPrice",
            "docs": [
              "The init price of the pool as a sqrt(token_b/token_a) Q64.64 value"
            ],
            "type": "u128"
          },
          {
            "name": "activationPoint",
            "docs": [
              "activation point"
            ],
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "pool",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolFees",
            "docs": [
              "Pool fee"
            ],
            "type": {
              "defined": {
                "name": "poolFeesStruct"
              }
            }
          },
          {
            "name": "tokenAMint",
            "docs": [
              "token a mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenBMint",
            "docs": [
              "token b mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenAVault",
            "docs": [
              "token a vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenBVault",
            "docs": [
              "token b vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "whitelistedVault",
            "docs": [
              "Whitelisted vault to be able to buy pool before activation_point"
            ],
            "type": "pubkey"
          },
          {
            "name": "partner",
            "docs": [
              "partner"
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidity",
            "docs": [
              "liquidity share"
            ],
            "type": "u128"
          },
          {
            "name": "padding",
            "docs": [
              "padding, previous reserve amount, be careful to use that field"
            ],
            "type": "u128"
          },
          {
            "name": "protocolAFee",
            "docs": [
              "protocol a fee"
            ],
            "type": "u64"
          },
          {
            "name": "protocolBFee",
            "docs": [
              "protocol b fee"
            ],
            "type": "u64"
          },
          {
            "name": "partnerAFee",
            "docs": [
              "partner a fee"
            ],
            "type": "u64"
          },
          {
            "name": "partnerBFee",
            "docs": [
              "partner b fee"
            ],
            "type": "u64"
          },
          {
            "name": "sqrtMinPrice",
            "docs": [
              "min price"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "docs": [
              "max price"
            ],
            "type": "u128"
          },
          {
            "name": "sqrtPrice",
            "docs": [
              "current price"
            ],
            "type": "u128"
          },
          {
            "name": "activationPoint",
            "docs": [
              "Activation point, can be slot or timestamp"
            ],
            "type": "u64"
          },
          {
            "name": "activationType",
            "docs": [
              "Activation type, 0 means by slot, 1 means by timestamp"
            ],
            "type": "u8"
          },
          {
            "name": "poolStatus",
            "docs": [
              "pool status, 0: enable, 1 disable"
            ],
            "type": "u8"
          },
          {
            "name": "tokenAFlag",
            "docs": [
              "token a flag"
            ],
            "type": "u8"
          },
          {
            "name": "tokenBFlag",
            "docs": [
              "token b flag"
            ],
            "type": "u8"
          },
          {
            "name": "collectFeeMode",
            "docs": [
              "0 is collect fee in both token, 1 only collect fee in token a, 2 only collect fee in token b"
            ],
            "type": "u8"
          },
          {
            "name": "poolType",
            "docs": [
              "pool type"
            ],
            "type": "u8"
          },
          {
            "name": "padding0",
            "docs": [
              "padding"
            ],
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "feeAPerLiquidity",
            "docs": [
              "cumulative"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "feeBPerLiquidity",
            "docs": [
              "cumulative"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "permanentLockLiquidity",
            "type": "u128"
          },
          {
            "name": "metrics",
            "docs": [
              "metrics"
            ],
            "type": {
              "defined": {
                "name": "poolMetrics"
              }
            }
          },
          {
            "name": "padding1",
            "docs": [
              "Padding for further use"
            ],
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          },
          {
            "name": "rewardInfos",
            "docs": [
              "Farming reward information"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "rewardInfo"
                  }
                },
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolFeeParameters",
      "docs": [
        "Information regarding fee charges"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseFee",
            "docs": [
              "Base fee"
            ],
            "type": {
              "defined": {
                "name": "baseFeeParameters"
              }
            }
          },
          {
            "name": "protocolFeePercent",
            "docs": [
              "Protocol trade fee percent"
            ],
            "type": "u8"
          },
          {
            "name": "partnerFeePercent",
            "docs": [
              "partner fee percent"
            ],
            "type": "u8"
          },
          {
            "name": "referralFeePercent",
            "docs": [
              "referral fee percent"
            ],
            "type": "u8"
          },
          {
            "name": "dynamicFee",
            "docs": [
              "dynamic fee"
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "dynamicFeeParameters"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "poolFeesConfig",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseFee",
            "type": {
              "defined": {
                "name": "baseFeeConfig"
              }
            }
          },
          {
            "name": "dynamicFee",
            "type": {
              "defined": {
                "name": "dynamicFeeConfig"
              }
            }
          },
          {
            "name": "protocolFeePercent",
            "type": "u8"
          },
          {
            "name": "partnerFeePercent",
            "type": "u8"
          },
          {
            "name": "referralFeePercent",
            "type": "u8"
          },
          {
            "name": "padding0",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "padding1",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolFeesStruct",
      "docs": [
        "Information regarding fee charges",
        "trading_fee = amount * trade_fee_numerator / denominator",
        "protocol_fee = trading_fee * protocol_fee_percentage / 100",
        "referral_fee = protocol_fee * referral_percentage / 100",
        "partner_fee = (protocol_fee - referral_fee) * partner_fee_percentage / denominator"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseFee",
            "docs": [
              "Trade fees are extra token amounts that are held inside the token",
              "accounts during a trade, making the value of liquidity tokens rise.",
              "Trade fee numerator"
            ],
            "type": {
              "defined": {
                "name": "baseFeeStruct"
              }
            }
          },
          {
            "name": "protocolFeePercent",
            "docs": [
              "Protocol trading fees are extra token amounts that are held inside the token",
              "accounts during a trade, with the equivalent in pool tokens minted to",
              "the protocol of the program.",
              "Protocol trade fee numerator"
            ],
            "type": "u8"
          },
          {
            "name": "partnerFeePercent",
            "docs": [
              "partner fee"
            ],
            "type": "u8"
          },
          {
            "name": "referralFeePercent",
            "docs": [
              "referral fee"
            ],
            "type": "u8"
          },
          {
            "name": "padding0",
            "docs": [
              "padding"
            ],
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "dynamicFee",
            "docs": [
              "dynamic fee"
            ],
            "type": {
              "defined": {
                "name": "dynamicFeeStruct"
              }
            }
          },
          {
            "name": "padding1",
            "docs": [
              "padding"
            ],
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolMetrics",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalLpAFee",
            "type": "u128"
          },
          {
            "name": "totalLpBFee",
            "type": "u128"
          },
          {
            "name": "totalProtocolAFee",
            "type": "u64"
          },
          {
            "name": "totalProtocolBFee",
            "type": "u64"
          },
          {
            "name": "totalPartnerAFee",
            "type": "u64"
          },
          {
            "name": "totalPartnerBFee",
            "type": "u64"
          },
          {
            "name": "totalPosition",
            "type": "u64"
          },
          {
            "name": "padding",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "position",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "nftMint",
            "docs": [
              "nft mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "feeAPerTokenCheckpoint",
            "docs": [
              "fee a checkpoint"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "feeBPerTokenCheckpoint",
            "docs": [
              "fee b checkpoint"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "feeAPending",
            "docs": [
              "fee a pending"
            ],
            "type": "u64"
          },
          {
            "name": "feeBPending",
            "docs": [
              "fee b pending"
            ],
            "type": "u64"
          },
          {
            "name": "unlockedLiquidity",
            "docs": [
              "unlock liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "vestedLiquidity",
            "docs": [
              "vesting liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "permanentLockedLiquidity",
            "docs": [
              "permanent locked liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "metrics",
            "docs": [
              "metrics"
            ],
            "type": {
              "defined": {
                "name": "positionMetrics"
              }
            }
          },
          {
            "name": "rewardInfos",
            "docs": [
              "Farming reward information"
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "userRewardInfo"
                  }
                },
                2
              ]
            }
          },
          {
            "name": "padding",
            "docs": [
              "padding for future usage"
            ],
            "type": {
              "array": [
                "u128",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "positionMetrics",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalClaimedAFee",
            "type": "u64"
          },
          {
            "name": "totalClaimedBFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "removeLiquidityParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "liquidityDelta",
            "docs": [
              "delta liquidity"
            ],
            "type": "u128"
          },
          {
            "name": "tokenAAmountThreshold",
            "docs": [
              "minimum token a amount"
            ],
            "type": "u64"
          },
          {
            "name": "tokenBAmountThreshold",
            "docs": [
              "minimum token b amount"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rewardInfo",
      "docs": [
        "Stores the state relevant for tracking liquidity mining rewards"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "docs": [
              "Indicates if the reward has been initialized"
            ],
            "type": "u8"
          },
          {
            "name": "rewardTokenFlag",
            "docs": [
              "reward token flag"
            ],
            "type": "u8"
          },
          {
            "name": "padding0",
            "docs": [
              "padding"
            ],
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "padding1",
            "docs": [
              "Padding to ensure `reward_rate: u128` is 16-byte aligned"
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "mint",
            "docs": [
              "Reward token mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Reward vault token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "funder",
            "docs": [
              "Authority account that allows to fund rewards"
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardDuration",
            "docs": [
              "reward duration"
            ],
            "type": "u64"
          },
          {
            "name": "rewardDurationEnd",
            "docs": [
              "reward duration end"
            ],
            "type": "u64"
          },
          {
            "name": "rewardRate",
            "docs": [
              "reward rate"
            ],
            "type": "u128"
          },
          {
            "name": "rewardPerTokenStored",
            "docs": [
              "Reward per token stored"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lastUpdateTime",
            "docs": [
              "The last time reward states were updated."
            ],
            "type": "u64"
          },
          {
            "name": "cumulativeSecondsWithEmptyLiquidityReward",
            "docs": [
              "Accumulated seconds when the farm distributed rewards but the bin was empty.",
              "These rewards will be carried over to the next reward time window."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "staticConfigParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolFees",
            "type": {
              "defined": {
                "name": "poolFeeParameters"
              }
            }
          },
          {
            "name": "sqrtMinPrice",
            "type": "u128"
          },
          {
            "name": "sqrtMaxPrice",
            "type": "u128"
          },
          {
            "name": "vaultConfigKey",
            "type": "pubkey"
          },
          {
            "name": "poolCreatorAuthority",
            "type": "pubkey"
          },
          {
            "name": "activationType",
            "type": "u8"
          },
          {
            "name": "collectFeeMode",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "swapParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "minimumAmountOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "swapResult",
      "docs": [
        "Encodes all results of swapping"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outputAmount",
            "type": "u64"
          },
          {
            "name": "nextSqrtPrice",
            "type": "u128"
          },
          {
            "name": "lpFee",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "partnerFee",
            "type": "u64"
          },
          {
            "name": "referralFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenBadge",
      "docs": [
        "Parameter that set by the protocol"
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenMint",
            "docs": [
              "token mint"
            ],
            "type": "pubkey"
          },
          {
            "name": "padding",
            "docs": [
              "Reserve"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "userRewardInfo",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rewardPerTokenCheckpoint",
            "docs": [
              "The latest update reward checkpoint"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rewardPendings",
            "docs": [
              "Current pending rewards"
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimedRewards",
            "docs": [
              "Total claimed rewards"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vesting",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "position",
            "type": "pubkey"
          },
          {
            "name": "cliffPoint",
            "type": "u64"
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "cliffUnlockLiquidity",
            "type": "u128"
          },
          {
            "name": "liquidityPerPeriod",
            "type": "u128"
          },
          {
            "name": "totalReleasedLiquidity",
            "type": "u128"
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                14
              ]
            }
          },
          {
            "name": "padding2",
            "type": {
              "array": [
                "u128",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vestingParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cliffPoint",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "periodFrequency",
            "type": "u64"
          },
          {
            "name": "cliffUnlockLiquidity",
            "type": "u128"
          },
          {
            "name": "liquidityPerPeriod",
            "type": "u128"
          },
          {
            "name": "numberOfPeriod",
            "type": "u16"
          }
        ]
      }
    }
  ]
};
