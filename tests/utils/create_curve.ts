import BN from "bn.js";
import {
  BaseFee,
  ConfigParameters,
  LiquidityDistributionParameters,
  LockedVestingParams,
} from "../instructions";
import Decimal from "decimal.js";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "./constants";
import { assert } from "chai";

function fromDecimalToBN(value: Decimal): BN {
  return new BN(value.floor().toFixed());
}
function getDeltaAmountBase(
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN
): BN {
  let numerator = liquidity.mul(upperSqrtPrice.sub(lowerSqrtPrice));
  let denominator = lowerSqrtPrice.mul(upperSqrtPrice);
  return numerator.add(denominator).sub(new BN(1)).div(denominator);
}
function getBaseTokenForSwap(
  sqrtStartPrice: BN,
  sqrtMigrationPrice: BN,
  curve: Array<LiquidityDistributionParameters>
): BN {
  let totalAmount = new BN(0);
  for (let i = 0; i < curve.length; i++) {
    let lowerSqrtPrice = i == 0 ? sqrtStartPrice : curve[i - 1].sqrtPrice;
    if (curve[i].sqrtPrice > sqrtMigrationPrice) {
      let deltaAmount = getDeltaAmountBase(
        lowerSqrtPrice,
        sqrtMigrationPrice,
        curve[i].liquidity
      );
      totalAmount = totalAmount.add(deltaAmount);
      break;
    } else {
      let deltaAmount = getDeltaAmountBase(
        lowerSqrtPrice,
        curve[i].sqrtPrice,
        curve[i].liquidity
      );
      totalAmount = totalAmount.add(deltaAmount);
    }
  }
  return totalAmount;
}

// Original formula: price = (sqrtPrice >> 64)^2 * 10^(tokenADecimal - tokenBDecimal)
// Reverse formula: sqrtPrice = sqrt(price / 10^(tokenADecimal - tokenBDecimal)) << 64
export const getSqrtPriceFromPrice = (
  price: string,
  tokenADecimal: number,
  tokenBDecimal: number
): BN => {
  const decimalPrice = new Decimal(price);
  const adjustedByDecimals = decimalPrice.div(
    new Decimal(10 ** (tokenADecimal - tokenBDecimal))
  );
  const sqrtValue = Decimal.sqrt(adjustedByDecimals);
  const sqrtValueQ64 = sqrtValue.mul(Decimal.pow(2, 64));

  return new BN(sqrtValueQ64.floor().toFixed());
};

export const getPriceFromSqrtPrice = (
  sqrtPrice: BN,
  tokenADecimal: number,
  tokenBDecimal: number
): Decimal => {
  const decimalSqrtPrice = new Decimal(sqrtPrice.toString());
  const price = decimalSqrtPrice
    .mul(decimalSqrtPrice)
    .mul(new Decimal(10 ** (tokenADecimal - tokenBDecimal)))
    .div(Decimal.pow(2, 128));

  return price;
};

// Δa = L * (1 / √P_lower - 1 / √P_upper) => L = Δa / (1 / √P_lower - 1 / √P_upper)
export const getInitialLiquidityFromDeltaBase = (
  baseAmount: BN,
  sqrtMaxPrice: BN,
  sqrtPrice: BN
): BN => {
  let priceDelta = sqrtMaxPrice.sub(sqrtPrice);
  let prod = baseAmount.mul(sqrtMaxPrice).mul(sqrtPrice);
  let liquidity = prod.div(priceDelta); // round down
  return liquidity;
};

// Δb = L (√P_upper - √P_lower) => L = Δb / (√P_upper - √P_lower)
export const getInitialLiquidityFromDeltaQuote = (
  quoteAmount: BN,
  sqrtMinPrice: BN,
  sqrtPrice: BN
): BN => {
  let priceDelta = sqrtPrice.sub(sqrtMinPrice);
  quoteAmount = quoteAmount.shln(128);
  let liquidity = quoteAmount.div(priceDelta); // round down
  return liquidity;
};

export const getLiquidity = (
  baseAmount: BN,
  quoteAmount: BN,
  minSqrtPrice: BN,
  maxSqrtPrice: BN
): BN => {
  let liquidityFromBase = getInitialLiquidityFromDeltaBase(
    baseAmount,
    maxSqrtPrice,
    minSqrtPrice
  );
  let liquidityFromQuote = getInitialLiquidityFromDeltaQuote(
    quoteAmount,
    minSqrtPrice,
    maxSqrtPrice
  );
  return BN.min(liquidityFromBase, liquidityFromQuote);
};

export const getFirstCurve = (
  migrationSqrPrice: BN,
  migrationAmount: BN,
  swapAmount: BN,
  migrationQuoteThreshold: BN
) => {
  let sqrtStartPrice = migrationSqrPrice.mul(migrationAmount).div(swapAmount);
  let liquidity = getLiquidity(
    swapAmount,
    migrationQuoteThreshold,
    sqrtStartPrice,
    migrationSqrPrice
  );
  return {
    sqrtStartPrice,
    curve: [
      {
        sqrtPrice: migrationSqrPrice,
        liquidity,
      },
    ],
  };
};
// Δb = L (√P_upper - √P_lower)
const getDeltaAmountQuote = (
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  liquidity: BN,
  round: String
): BN => {
  let detalPrice = upperSqrtPrice.sub(lowerSqrtPrice);
  let prod = liquidity.mul(detalPrice);
  let denominator = new BN(1).shln(128);
  if (round == "U") {
    let result = prod.add(denominator).sub(new BN(1)).div(denominator);
    return result;
  } else if (round == "D") {
    let result = prod.div(denominator);
    return result;
  } else {
    throw Error("Invalid rounding");
  }
};

const getNextSqrtPriceFromInput = (
  sqrtPrice: BN,
  liquidity: BN,
  amountIn: BN,
  baseForQuote: boolean
): BN => {
  // round to make sure that we don't pass the target price
  if (baseForQuote) {
    return getNextSqrtPriceFromAmountBaseRoundingUp(
      sqrtPrice,
      liquidity,
      amountIn
    );
  } else {
    return getNextSqrtPriceFromAmountQuoteRoundingDown(
      sqrtPrice,
      liquidity,
      amountIn
    );
  }
};

//  √P' = √P * L / (L + Δx * √P)
const getNextSqrtPriceFromAmountBaseRoundingUp = (
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN
): BN => {
  if (amount.isZero()) {
    return sqrtPrice;
  }
  let prod = sqrtPrice.mul(liquidity);
  let denominator = liquidity.add(amount.mul(sqrtPrice));
  let result = prod.add(denominator).sub(new BN(1)).div(denominator);
  return result;
};

/// * `√P' = √P + Δy / L`
///
const getNextSqrtPriceFromAmountQuoteRoundingDown = (
  sqrtPrice: BN,
  liquidity: BN,
  amount: BN
): BN => {
  return sqrtPrice.add(amount.shln(128).div(liquidity));
};

const getSqrtPriceFromMarketCap = (
  marketCap: number,
  totalSupply: number,
  tokenBaseDecimal: number,
  tokenQuoteDecimal: number
): BN => {
  let price = new Decimal(marketCap).div(new Decimal(totalSupply));
  return getSqrtPriceFromPrice(
    price.toString(),
    tokenBaseDecimal,
    tokenQuoteDecimal
  );
};

const getMigrationThresholdPrice = (
  migrationThreshold: BN,
  sqrtStartPrice: BN,
  curve: Array<LiquidityDistributionParameters>
): BN => {
  let nextSqrtPrice = sqrtStartPrice;
  let totalAmount = getDeltaAmountQuote(
    nextSqrtPrice,
    curve[0].sqrtPrice,
    curve[0].liquidity,
    "U"
  );
  if (totalAmount.gt(migrationThreshold)) {
    nextSqrtPrice = getNextSqrtPriceFromInput(
      nextSqrtPrice,
      curve[0].liquidity,
      migrationThreshold,
      false
    );
  } else {
    let amountLeft = migrationThreshold.sub(totalAmount);
    nextSqrtPrice = curve[0].sqrtPrice;
    for (let i = 1; i < curve.length; i++) {
      let maxAmount = getDeltaAmountQuote(
        nextSqrtPrice,
        curve[i].sqrtPrice,
        curve[i].liquidity,
        "U"
      );
      if (maxAmount.gt(amountLeft)) {
        nextSqrtPrice = getNextSqrtPriceFromInput(
          nextSqrtPrice,
          curve[i].liquidity,
          amountLeft,
          false
        );
        amountLeft = new BN(0);
        break;
      } else {
        amountLeft = amountLeft.sub(maxAmount);
        nextSqrtPrice = curve[i].sqrtPrice;
      }
    }
    if (!amountLeft.isZero()) {
      console.log("migrationThreshold: ", migrationThreshold.toString());
      throw Error("Not enough liquidity, amountLeft: " + amountLeft.toString());
    }
  }
  return nextSqrtPrice;
};

const getSwapAmountWithBuffer = (
  swapBaseAmount: BN,
  sqrtStartPrice: BN,
  curve: Array<LiquidityDistributionParameters>
): BN => {
  let swapAmountBuffer = swapBaseAmount.add(
    swapBaseAmount.mul(new BN(25)).div(new BN(100))
  );
  let maxBaseAmountOnCurve = getBaseTokenForSwap(
    sqrtStartPrice,
    MAX_SQRT_PRICE,
    curve
  );
  return BN.min(swapAmountBuffer, maxBaseAmountOnCurve);
};

const getMigrationBaseToken = (
  migrationQuoteThreshold: BN,
  sqrtMigrationPrice: BN,
  migrationOption: number
): BN => {
  if (migrationOption == 0) {
    let price = sqrtMigrationPrice.mul(sqrtMigrationPrice);
    let quote = migrationQuoteThreshold.shln(128);
    let { div, mod } = quote.divmod(price);
    if (!mod.isZero()) {
      div = div.add(new BN(1));
    }
    return div;
  } else if (migrationOption == 1) {
    let liquidity = getInitialLiquidityFromDeltaQuote(
      migrationQuoteThreshold,
      MIN_SQRT_PRICE,
      sqrtMigrationPrice
    );
    // calculate base threshold
    let baseAmount = getDeltaAmountBase(
      sqrtMigrationPrice,
      MAX_SQRT_PRICE,
      liquidity
    );
    return baseAmount;
  } else {
    throw Error("Invalid migration option");
  }
};

export const getTotalSupplyFromCurve = (
  migrationQuoteThreshold: BN,
  sqrtStartPrice: BN,
  curve: Array<LiquidityDistributionParameters>,
  lockedVesting: LockedVestingParams,
  migrationOption: number,
  leftOver: BN
): BN => {
  let sqrtMigrationPrice = getMigrationThresholdPrice(
    migrationQuoteThreshold,
    sqrtStartPrice,
    curve
  );
  let swapBaseAmount = getBaseTokenForSwap(
    sqrtStartPrice,
    sqrtMigrationPrice,
    curve
  );
  let swapBaseAmountBuffer = getSwapAmountWithBuffer(
    swapBaseAmount,
    sqrtStartPrice,
    curve
  );
  let migrationBaseAmount = getMigrationBaseToken(
    migrationQuoteThreshold,
    sqrtMigrationPrice,
    migrationOption
  );
  let totalVestingAmount = getTotalVestingAmount(lockedVesting);
  let minimumBaseSupplyWithBuffer = swapBaseAmountBuffer
    .add(migrationBaseAmount)
    .add(totalVestingAmount)
    .add(leftOver);
  return minimumBaseSupplyWithBuffer;
};

export const getTotalVestingAmount = (
  lockedVesting: LockedVestingParams
): BN => {
  let totalVestingAmount = lockedVesting.cliffUnlockAmount.add(
    lockedVesting.amountPerPeriod.mul(lockedVesting.numberOfPeriod)
  );
  return totalVestingAmount;
};

export function designCurve(
  totalTokenSupply: number,
  percentageSupplyOnMigration: number,
  migrationQuoteThreshold: number,
  migrationOption: number,
  tokenBaseDecimal: number,
  tokenQuoteDecimal: number,
  creatorTradingFeePercentage: number,
  collectFeeMode: number,
  lockedVesting: LockedVestingParams,
  opts?: {
    baseFeeOption?: {
      baseFeeMode: number;
      cliffFeeNumerator: BN;
      firstFactor: number;
      secondFactor: BN;
      thirdFactor: BN;
    };
  }
): ConfigParameters {
  let migrationBaseSupply = new BN(totalTokenSupply)
    .mul(new BN(percentageSupplyOnMigration))
    .div(new BN(100));

  let totalSupply = new BN(totalTokenSupply).mul(
    new BN(10).pow(new BN(tokenBaseDecimal))
  );
  let migrationQuoteThresholdWithDecimals = new BN(
    migrationQuoteThreshold * 10 ** tokenQuoteDecimal
  );

  let migrationPrice = new Decimal(migrationQuoteThreshold.toString()).div(
    new Decimal(migrationBaseSupply.toString())
  );
  let migrateSqrtPrice = getSqrtPriceFromPrice(
    migrationPrice.toString(),
    tokenBaseDecimal,
    tokenQuoteDecimal
  );

  let migrationBaseAmount = getMigrationBaseToken(
    new BN(migrationQuoteThresholdWithDecimals),
    migrateSqrtPrice,
    migrationOption
  );
  let totalVestingAmount = getTotalVestingAmount(lockedVesting);
  let swapAmount = totalSupply.sub(migrationBaseAmount).sub(totalVestingAmount);

  let { sqrtStartPrice, curve } = getFirstCurve(
    migrateSqrtPrice,
    migrationBaseAmount,
    swapAmount,
    migrationQuoteThresholdWithDecimals
  );

  let totalDynamicSupply = getTotalSupplyFromCurve(
    migrationQuoteThresholdWithDecimals,
    sqrtStartPrice,
    curve,
    lockedVesting,
    migrationOption,
    new BN(0)
  );

  let remainingAmount = totalSupply.sub(totalDynamicSupply);

  let lastLiquidity = getInitialLiquidityFromDeltaBase(
    remainingAmount,
    MAX_SQRT_PRICE,
    migrateSqrtPrice
  );
  if (!lastLiquidity.isZero()) {
    curve.push({
      sqrtPrice: MAX_SQRT_PRICE,
      liquidity: lastLiquidity,
    });
  }

  const instructionParams: ConfigParameters = {
    poolFees: {
      baseFee: opts?.baseFeeOption || {
        cliffFeeNumerator: new BN(2_500_000),
        firstFactor: 0,
        secondFactor: new BN(0),
        thirdFactor: new BN(0),
        baseFeeMode: 0,
      },
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode,
    migrationOption,
    tokenType: 0, // spl_token
    tokenDecimal: tokenBaseDecimal,
    migrationQuoteThreshold: migrationQuoteThresholdWithDecimals,
    partnerLpPercentage: 0,
    creatorLpPercentage: 0,
    partnerLockedLpPercentage: 100,
    creatorLockedLpPercentage: 0,
    sqrtStartPrice,
    lockedVesting,
    migrationFeeOption: 0,
    tokenSupply: {
      preMigrationTokenSupply: totalSupply,
      postMigrationTokenSupply: totalSupply,
    },
    creatorTradingFeePercentage,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    migratedPoolFee: {
      collectFeeMode: 0,
      dynamicFee: 0,
      poolFeeBps: 0,
    },
    padding: [],
    curve,
  };
  return instructionParams;
}

export function designGraphCurve(
  totalTokenSupply: number,
  initialMarketCap: number,
  migrationMarketCap: number,
  migrationOption: number,
  tokenBaseDecimal: number,
  tokenQuoteDecimal: number,
  creatorTradingFeePercentage: number,
  collectFeeMode: number,
  lockedVesting: LockedVestingParams,
  leftOver: number,
  kFactor: number,
  baseFee: BaseFee
): ConfigParameters {
  // 1. finding Pmax and Pmin
  let pMin = getSqrtPriceFromMarketCap(
    initialMarketCap,
    totalTokenSupply,
    tokenBaseDecimal,
    tokenQuoteDecimal
  );
  let pMax = getSqrtPriceFromMarketCap(
    migrationMarketCap,
    totalTokenSupply,
    tokenBaseDecimal,
    tokenQuoteDecimal
  );

  // find q^16 = pMax / pMin
  let priceRatio = new Decimal(pMax.toString()).div(
    new Decimal(pMin.toString())
  );
  let qDecimal = priceRatio.pow(new Decimal(1).div(new Decimal(16)));

  // finding all prices
  let sqrtPrices = [];
  let currentPrice = pMin;
  for (let i = 0; i < 17; i++) {
    sqrtPrices.push(currentPrice);
    currentPrice = fromDecimalToBN(
      qDecimal.mul(new Decimal(currentPrice.toString()))
    );
  }

  let totalSupply = new BN(totalTokenSupply).mul(
    new BN(10).pow(new BN(tokenBaseDecimal))
  );
  let totalLeftover = new BN(leftOver).mul(
    new BN(10).pow(new BN(tokenBaseDecimal))
  );
  let totalVestingAmount = getTotalVestingAmount(lockedVesting);

  let totalSwapAndMigrationAmount = totalSupply
    .sub(totalVestingAmount)
    .sub(totalLeftover);

  let kDecimal = new Decimal(kFactor);
  let sumFactor = new Decimal(0);
  let pmaxWeight = new Decimal(pMax.toString());
  for (let i = 1; i < 17; i++) {
    let pi = new Decimal(sqrtPrices[i].toString());
    let piMinus = new Decimal(sqrtPrices[i - 1].toString());
    let k = kDecimal.pow(new Decimal(i - 1));
    let w1 = pi.sub(piMinus).div(pi.mul(piMinus));
    let w2 = pi.sub(piMinus).div(pmaxWeight.mul(pmaxWeight));
    let weight = k.mul(w1.add(w2));
    sumFactor = sumFactor.add(weight);
  }

  let l1 = new Decimal(totalSwapAndMigrationAmount.toString()).div(sumFactor);

  // construct curve
  let curve = [];
  for (let i = 0; i < 16; i++) {
    let k = kDecimal.pow(new Decimal(i));
    let liquidity = fromDecimalToBN(l1.mul(k));
    let sqrtPrice = i < 15 ? sqrtPrices[i + 1] : pMax;
    curve.push({
      sqrtPrice,
      liquidity,
    });
  }
  // reverse to calculate swap amount and migration amount
  let swapBaseAmount = getBaseTokenForSwap(pMin, pMax, curve);
  let swapBaseAmountBuffer = getSwapAmountWithBuffer(
    swapBaseAmount,
    pMin,
    curve
  );

  let migrationAmount = totalSwapAndMigrationAmount.sub(swapBaseAmountBuffer);

  // calculate migration threshold
  let migrationQuoteThreshold = migrationAmount.mul(pMax).mul(pMax).shrn(128);

  // sanity check
  let totalDynamicSupply = getTotalSupplyFromCurve(
    migrationQuoteThreshold,
    pMin,
    curve,
    lockedVesting,
    migrationOption,
    totalLeftover
  );

  if (totalDynamicSupply.gt(totalSupply)) {
    // precision loss is used for leftover
    let leftOverDelta = totalDynamicSupply.sub(totalSupply);
    assert(leftOverDelta.lt(totalLeftover));
  }

  const instructionParams: ConfigParameters = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode,
    migrationOption,
    tokenType: 0, // spl_token
    tokenDecimal: tokenBaseDecimal,
    migrationQuoteThreshold,
    partnerLpPercentage: 0,
    creatorLpPercentage: 0,
    partnerLockedLpPercentage: 100,
    creatorLockedLpPercentage: 0,
    sqrtStartPrice: pMin,
    lockedVesting,
    migrationFeeOption: 0,
    tokenUpdateAuthority: 0,
    tokenSupply: {
      preMigrationTokenSupply: totalSupply,
      postMigrationTokenSupply: totalSupply,
    },
    creatorTradingFeePercentage,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    migratedPoolFee: {
      collectFeeMode: 0,
      dynamicFee: 0,
      poolFeeBps: 0,
    },
    padding: [],
    curve,
  };
  return instructionParams;
}
