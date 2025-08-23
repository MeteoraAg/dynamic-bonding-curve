# Fork and Test Guide

## Step 1: Fork on GitHub
1. Go to https://github.com/MeteoraAg/dynamic-bonding-curve
2. Click "Fork" button in the top right
3. Select your GitHub account as the destination

## Step 2: Add Your Fork as Remote (on Windows)
```bash
# Add your fork as a new remote (replace YOUR_USERNAME with your GitHub username)
git remote add myfork https://github.com/YOUR_USERNAME/dynamic-bonding-curve.git

# Create a new branch for the exploit
git checkout -b exploit-poc

# Add the exploit test file
git add tests/exploit_surplus_manipulation.tests.ts

# Commit the changes
git commit -m "Add surplus manipulation exploit PoC for C4 audit"

# Push to your fork
git push myfork exploit-poc
```

## Step 3: Clone and Test on Mac

On your Mac, run:

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/dynamic-bonding-curve.git
cd dynamic-bonding-curve

# Checkout the exploit branch
git checkout exploit-poc

# Install Rust and Solana tools if not already installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anchor-lang.com/v0.31.0/install)"

# Install dependencies
pnpm install

# Build the project with local features
anchor build -p dynamic_bonding_curve -- --features local

# Run the exploit test specifically
npx ts-mocha --runInBand -p ./tsconfig.json -t 1000000 tests/exploit_surplus_manipulation.tests.ts

# Or run all tests
pnpm test
```

## Expected Test Output

```
CRITICAL: Surplus Manipulation Exploit
  ✓ EXPLOIT: Creates 4999 SOL artificial surplus from 1 SOL needed to complete
  ✓ CONTROL TEST: swapPartialFill prevents the exploit

2 passing
```

## Files to Verify Are Included

Make sure these files are in your fork:
- `tests/exploit_surplus_manipulation.tests.ts` - The exploit PoC
- `FINAL_C4_SUBMISSION.md` - Your C4 submission text
- `poc_test_simplified.js` - Simplified logic demonstration

## Quick Commands for Your Fork

```bash
# View current branch
git branch

# Check status
git status

# See your remotes
git remote -v

# Push updates to your fork
git push myfork exploit-poc
```

## Testing Checklist for Mac

- [ ] Rust 1.79.0+ installed
- [ ] Anchor CLI 0.31.0 installed
- [ ] Node.js 18+ installed
- [ ] pnpm installed
- [ ] Project builds successfully
- [ ] Exploit test runs and passes
- [ ] Control test confirms mitigation

## Submitting to Code4rena

Once confirmed working on Mac:
1. Copy content from `FINAL_C4_SUBMISSION.md`
2. Include test output as evidence
3. Reference your GitHub fork with the working PoC
4. Submit as HIGH severity finding