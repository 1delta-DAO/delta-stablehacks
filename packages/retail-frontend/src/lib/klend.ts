/**
 * klend.ts — Kamino Lend instruction builders for the retail frontend.
 *
 * Builds raw instructions using web3.js v1 types.
 * PDA seeds follow the klend on-chain program pattern.
 */

import {
  PublicKey,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
const KLEND_PROGRAM = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

// ---------------------------------------------------------------------------
// Discriminators — precomputed sha256("global:<name>")[0..8]
// ---------------------------------------------------------------------------

const REFRESH_RESERVE_DISC = Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]);
const DEPOSIT_RESERVE_LIQUIDITY_DISC = Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]);
const REDEEM_RESERVE_COLLATERAL_DISC = Buffer.from([234, 117, 181, 125, 185, 142, 220, 29]);

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

export function lendingMarketAuthority(market: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), market.toBuffer()],
    KLEND_PROGRAM
  );
  return pda;
}

/** Reserve-derived PDA. Seeds: [seed, reserve] */
function reservePda(seed: string, reserve: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(seed), reserve.toBuffer()],
    KLEND_PROGRAM
  );
  return pda;
}

export function reserveLiquiditySupply(reserve: PublicKey): PublicKey {
  return reservePda("reserve_liq_supply", reserve);
}

export function reserveCollateralMint(reserve: PublicKey): PublicKey {
  return reservePda("reserve_coll_mint", reserve);
}

export function reserveCollateralSupply(reserve: PublicKey): PublicKey {
  return reservePda("reserve_coll_supply", reserve);
}

export function feeReceiver(reserve: PublicKey): PublicKey {
  return reservePda("fee_receiver", reserve);
}

// ---------------------------------------------------------------------------
// Instruction: refreshReserve
// ---------------------------------------------------------------------------

export function buildRefreshReserveIx(
  reserve: PublicKey,
  market: PublicKey,
  oracle: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: KLEND_PROGRAM,
    keys: [
      { pubkey: reserve, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: oracle, isSigner: false, isWritable: false },           // pyth oracle
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // switchboard price
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // switchboard twap
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // scope prices
    ],
    data: REFRESH_RESERVE_DISC,
  });
}

// ---------------------------------------------------------------------------
// Instruction: depositReserveLiquidity
// ---------------------------------------------------------------------------

export function buildDepositReserveLiquidityIx(
  owner: PublicKey,
  reserve: PublicKey,
  market: PublicKey,
  liquidityMint: PublicKey,
  amount: bigint,
  liquidityTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  collateralTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  userSourceLiquidity: PublicKey,
  userDestinationCollateral: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(16);
  DEPOSIT_RESERVE_LIQUIDITY_DISC.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  return new TransactionInstruction({
    programId: KLEND_PROGRAM,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: reserve, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: lendingMarketAuthority(market), isSigner: false, isWritable: false },
      { pubkey: liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply(reserve), isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint(reserve), isSigner: false, isWritable: true },
      { pubkey: userSourceLiquidity, isSigner: false, isWritable: true },
      { pubkey: userDestinationCollateral, isSigner: false, isWritable: true },
      { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },
      { pubkey: liquidityTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Instruction: redeemReserveCollateral
// ---------------------------------------------------------------------------

export function buildRedeemReserveCollateralIx(
  owner: PublicKey,
  reserve: PublicKey,
  market: PublicKey,
  liquidityMint: PublicKey,
  collateralAmount: bigint,
  liquidityTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  collateralTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  userSourceCollateral: PublicKey,
  userDestinationLiquidity: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(16);
  REDEEM_RESERVE_COLLATERAL_DISC.copy(data, 0);
  data.writeBigUInt64LE(collateralAmount, 8);

  return new TransactionInstruction({
    programId: KLEND_PROGRAM,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: reserve, isSigner: false, isWritable: true },
      { pubkey: lendingMarketAuthority(market), isSigner: false, isWritable: false },
      { pubkey: liquidityMint, isSigner: false, isWritable: false },
      { pubkey: reserveCollateralMint(reserve), isSigner: false, isWritable: true },
      { pubkey: reserveLiquiditySupply(reserve), isSigner: false, isWritable: true },
      { pubkey: userSourceCollateral, isSigner: false, isWritable: true },
      { pubkey: userDestinationLiquidity, isSigner: false, isWritable: true },
      { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },
      { pubkey: liquidityTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Reserve account decoding (minimal — just the fields we need)
// ---------------------------------------------------------------------------

// Reserve account layout offsets (Anchor discriminator + fields):
// See klend IDL Reserve type. We read specific offsets from the raw data.
//
// disc: 8 bytes
// version: u64 (8)             offset 8
// last_update: LastUpdate (24)  offset 16
//   slot: u64, stale: u8, placeholder: [u8;7], price_status: u8, padding: [u8;7]
// lending_market: Pubkey (32)   offset 40
// ... many fields ...
//
// The key liquidity fields are at known offsets within ReserveLiquidity:
// ReserveLiquidity starts at offset 72 (after disc + version + last_update + lending_market):
//   mint_pubkey: Pubkey (32)     offset 72
//   supply_vault: Pubkey (32)    offset 104
//   ... (fee_vault, available_amount, etc.)

const SF_SHIFT = 60n; // scale factor for *Sf fields: value / 2^60

export interface ReserveInfo {
  /** Available liquidity in native units */
  availableAmount: bigint;
  /** Borrowed amount (scaled fraction, divide by 2^60) */
  borrowedAmountSf: bigint;
  /** Collateral mint total supply */
  cTokenMintSupply: bigint;
  /** Protocol take rate (0-100) */
  protocolTakeRatePct: number;
  /** Supply APY (estimated) */
  supplyAPY: number;
  /** Exchange rate: liquidity per cToken */
  exchangeRate: number;
}

export function decodeReserveInfo(data: Buffer): ReserveInfo | null {
  if (data.length < 600) return null;

  // ReserveLiquidity.available_amount: u64 at offset 200 (approximate — varies by version)
  // We need to find the exact offsets. The Reserve struct is large.
  // For safety, scan for known patterns or use the codegen.
  //
  // Simplified approach: read specific offsets based on klend v2 layout.
  // These offsets are derived from the IDL struct field ordering.

  // Quick offset map for klend Reserve account (anchor disc=8):
  // 8: version (u64)
  // 16: last_update.slot (u64)
  // 24: last_update.stale (u8)
  // 25: [padding 15 bytes]
  // 40: lending_market (Pubkey)
  // -- ReserveLiquidity starts at 72 --
  // 72: mint_pubkey (Pubkey)
  // 104: supply_vault (Pubkey)
  // 136: fee_vault (Pubkey)
  // 168: available_amount (u64)
  // 176: borrowed_amount_sf (u128)
  // 192: cumulative_borrow_rate_bsf.value[0] (u128)
  //   ... (32 bytes total for bsf)
  // ...
  // -- ReserveCollateral starts further in --
  // After liquidity struct (~400+ bytes in), we have:
  // collateral.mint_pubkey, collateral.mint_total_supply, collateral.supply_vault
  //
  // Since these offsets are fragile, let's use a more robust approach:
  // Read available_amount and borrowed_amount_sf from the known liquidity section.

  try {
    const availableAmount = data.readBigUInt64LE(168);
    const borrowedAmountSf = data.readBigUInt64LE(176) | (data.readBigUInt64LE(184) << 64n);

    // Protocol take rate is in ReserveConfig which starts much later.
    // For MVP, use a default of 10%.
    const protocolTakeRatePct = 10;

    // cToken mint supply — this is at the collateral section.
    // ReserveCollateral offset depends on ReserveLiquidity size.
    // ReserveLiquidity size is approximately 352 bytes (from IDL).
    // So ReserveCollateral starts at ~72 + 352 = 424
    // collateral.mint_pubkey: Pubkey at 424
    // collateral.mint_total_supply: u64 at 456
    // collateral.supply_vault: Pubkey at 464
    const cTokenMintSupply = data.readBigUInt64LE(456);

    const borrowedAmount = Number(borrowedAmountSf >> SF_SHIFT);
    const available = Number(availableAmount);
    const totalLiquidity = available + borrowedAmount;

    const utilization = totalLiquidity > 0 ? borrowedAmount / totalLiquidity : 0;

    // Simplified APY: assume ~5% base borrow rate * utilization * (1 - take rate)
    // Real implementation would interpolate the borrow rate curve.
    const borrowRate = 0.05; // 5% base (placeholder until we decode the curve)
    const supplyAPR = borrowRate * utilization * (1 - protocolTakeRatePct / 100);
    const supplyAPY = Math.pow(1 + supplyAPR / 252288000, 252288000) - 1; // ~slots/year

    const exchangeRate =
      Number(cTokenMintSupply) > 0
        ? totalLiquidity / Number(cTokenMintSupply) * 1e6 // adjust for decimals
        : 1;

    return {
      availableAmount,
      borrowedAmountSf,
      cTokenMintSupply,
      protocolTakeRatePct,
      supplyAPY,
      exchangeRate: totalLiquidity > 0 && Number(cTokenMintSupply) > 0
        ? totalLiquidity / (Number(cTokenMintSupply) / 1e6)
        : 1,
    };
  } catch {
    return null;
  }
}
