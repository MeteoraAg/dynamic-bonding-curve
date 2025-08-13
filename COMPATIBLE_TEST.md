## Run compatible test guide

### The reason behind this
Backwards compatibility testing ensures that instruction data (IX data) generated from previous program versions can still be executed successfully on newer versions of the program.
This is critical for Program Upgrades when deploying program updates to mainnet from older versions must continue to work without failing.

The test works by:
1. Generating instruction data using the exact same parameters and program interface from previous idl version
2. Attempting to execute these instruction data with the current program version.
3. Verifying that all previous instructions data complete successfully without aborting.

### How to run ?

- Step 1: Prepare data
```bash
    anchor run ixdata -- path_to_idl_file
```

ex: `anchor run ixdata -- release_0.1.2.json`

(Can update more IDL versions under `./scripts/idl/..`)

- Step 2 Run compatible test
```bash
pnpm ctest
```
