import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { getObligationPda, findObligationReserves, OB_ID } from "../lib/obligation";

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const MARKET = new PublicKey("45FNL648aXgbMoMzLfYE2vCZAtWWDCky2tYLCEUztc98");
const COLLATERAL_RESERVE = new PublicKey("3FkBgVfnYBnUre6GMQZv8w4dDM1x7Fp5RiGk96kZ5mVs");
const COLLATERAL_ORACLE = new PublicKey("6dbNQrjLVQxk1bJhbB6AiMFWzaf8G2d3LPjH69Je498A");
const USDC_RESERVE = new PublicKey("AYhwFLgzxWwqznhxv6Bg1NVnNeoDNu9SBGLzM1W3hSfb");
const USDC_ORACLE = new PublicKey("EN2FsFZFdpiFAWpKDZqeJ2PY8EyE7xzz9Ew8ZQVhtHCJ");
const USDC_MINT = new PublicKey("8iBux2LRja1PhVZph8Rw4Hi45pgkaufNEiaZma5nTD5g");

const DISC = {
  refresh_reserve: Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]),
  refresh_obligation: Buffer.from([33, 132, 147, 228, 151, 192, 72, 89]),
  borrow_obligation_liquidity: Buffer.from([121, 127, 18, 204, 73, 245, 225, 65]),
};

interface PositionData {
  collateralDeposited: number;
  collateralValueUsd: number;
  borrowedUsdc: number;
  maxBorrowUsd: number;
  availableToBorrow: number;
  healthFactor: number | null;
  ltvPct: number;
  liqThreshPct: number;
  collateralPrice: number;
  usdcLiquidity: number;
}

export default function BorrowPage() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<{ msg: string; type: "info" | "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<PositionData | null>(null);
  const [loadingPosition, setLoadingPosition] = useState(true);

  async function signAndSend(tx: Transaction): Promise<string> {
    if (!signTransaction || !publicKey) throw new Error("Wallet not connected");
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  // Load on-chain position data
  const loadPosition = useCallback(async () => {
    if (!publicKey) return;
    setLoadingPosition(true);

    try {
      // Read collateral reserve config (raw bytes)
      const collInfo = await connection.getAccountInfo(COLLATERAL_RESERVE);
      const ltvPct = collInfo ? collInfo.data[4872] : 0;
      const liqThreshPct = collInfo ? collInfo.data[4873] : 0;

      // Read collateral oracle price
      const oracleInfo = await connection.getAccountInfo(COLLATERAL_ORACLE);
      let collateralPrice = 1.08; // fallback
      if (oracleInfo && oracleInfo.data.length >= 133) {
        const rawPrice = oracleInfo.data.readBigInt64LE(73);
        const expo = oracleInfo.data.readInt32LE(89);
        collateralPrice = Number(rawPrice) * Math.pow(10, expo);
      }

      // Read USDC reserve liquidity vault balance
      const [usdcLiqSupply] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve_liq_supply"), USDC_RESERVE.toBuffer()], KLEND
      );
      const vaultInfo = await connection.getAccountInfo(usdcLiqSupply);
      const usdcLiquidity = vaultInfo ? Number(vaultInfo.data.readBigUInt64LE(64)) / 1e6 : 0;

      // Read obligation
      const [obPda] = PublicKey.findProgramAddressSync(
        [Buffer.from([0]), Buffer.from([OB_ID]), publicKey.toBuffer(), MARKET.toBuffer(),
         PublicKey.default.toBuffer(), PublicKey.default.toBuffer()], KLEND
      );
      const obInfo = await connection.getAccountInfo(obPda);

      let collateralDeposited = 0;
      let borrowedUsdc = 0;

      if (obInfo && obInfo.data.length > 200) {
        // Search for collateral reserve in obligation deposits
        const collBuf = COLLATERAL_RESERVE.toBuffer();
        for (let i = 64; i < Math.min(obInfo.data.length - 32, 1000); i++) {
          if (obInfo.data.subarray(i, i + 32).equals(collBuf)) {
            // Deposit amount is a u64 at offset +32 from the reserve pubkey
            // (ObligationCollateral: deposit_reserve(32) + deposited_amount(u64) + ...)
            try {
              const depositedRaw = obInfo.data.readBigUInt64LE(i + 32);
              collateralDeposited = Number(depositedRaw) / 1e6;
            } catch {}
            break;
          }
        }

        // Search for borrow reserve
        // ObligationLiquidity layout: reserve(32) + cumulative_borrow_rate_bsf(16) + padding(8) + borrowed_amount_sf(16) + ...
        // borrowed_amount_sf is a u128 scaled by 2^60
        const usdcBuf = USDC_RESERVE.toBuffer();
        for (let i = 900; i < Math.min(obInfo.data.length - 32, 1800); i++) {
          if (obInfo.data.subarray(i, i + 32).equals(usdcBuf)) {
            try {
              // borrowed_amount_sf at offset +56 (32 + 16 + 8 = 56), u128 = lo(u64) + hi(u64)
              const borrowedSfLo = obInfo.data.readBigUInt64LE(i + 56);
              const borrowedSfHi = obInfo.data.readBigUInt64LE(i + 64);
              const borrowedSf = borrowedSfLo + (borrowedSfHi << 64n);
              const FRACTION_ONE = 1n << 60n;
              borrowedUsdc = Number(borrowedSf * 1000000n / FRACTION_ONE) / 1e6;
            } catch {}
            break;
          }
        }
      }

      const collateralValueUsd = collateralDeposited * collateralPrice;
      const maxBorrowUsd = collateralValueUsd * (ltvPct / 100);
      const availableToBorrow = Math.min(maxBorrowUsd - borrowedUsdc, usdcLiquidity);
      const healthFactor = borrowedUsdc > 0
        ? (collateralValueUsd * (liqThreshPct / 100)) / borrowedUsdc
        : null;

      setPosition({
        collateralDeposited,
        collateralValueUsd,
        borrowedUsdc,
        maxBorrowUsd,
        availableToBorrow: Math.max(0, availableToBorrow),
        healthFactor,
        ltvPct,
        liqThreshPct,
        collateralPrice,
        usdcLiquidity,
      });
    } catch (e) {
      console.warn("Failed to load position:", e);
    } finally {
      setLoadingPosition(false);
    }
  }, [publicKey, connection]);

  useEffect(() => { loadPosition(); }, [loadPosition]);

  async function handleBorrow() {
    if (!publicKey || !amount) return;
    setLoading(true);
    setStatus({ msg: "Building borrow transaction...", type: "info" });

    try {
      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e6));

      const [obPda] = PublicKey.findProgramAddressSync(
        [Buffer.from([0]), Buffer.from([OB_ID]), publicKey.toBuffer(), MARKET.toBuffer(),
         PublicKey.default.toBuffer(), PublicKey.default.toBuffer()], KLEND
      );
      const obInfo = await connection.getAccountInfo(obPda);
      if (!obInfo) {
        setStatus({ msg: "No obligation found. Deposit collateral first.", type: "error" });
        setLoading(false);
        return;
      }

      // Check borrow capacity
      if (position && parseFloat(amount) > position.availableToBorrow) {
        setStatus({
          msg: `Cannot borrow ${amount} USDC. Max available: ${position.availableToBorrow.toFixed(2)} (collateral: $${position.collateralValueUsd.toFixed(2)} × ${position.ltvPct}% LTV - $${position.borrowedUsdc.toFixed(2)} existing borrows)`,
          type: "error"
        });
        setLoading(false);
        return;
      }

      const [lma] = PublicKey.findProgramAddressSync([Buffer.from("lma"), MARKET.toBuffer()], KLEND);
      const [usdcLiqSupply] = PublicKey.findProgramAddressSync([Buffer.from("reserve_liq_supply"), USDC_RESERVE.toBuffer()], KLEND);
      const [usdcFeeRecv] = PublicKey.findProgramAddressSync([Buffer.from("fee_receiver"), USDC_RESERVE.toBuffer()], KLEND);
      const userUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, publicKey);

      const tx = new Transaction();

      for (const [reserve, oracle] of [[COLLATERAL_RESERVE, COLLATERAL_ORACLE], [USDC_RESERVE, USDC_ORACLE]]) {
        tx.add({ programId: KLEND, data: DISC.refresh_reserve, keys: [
          { pubkey: reserve, isSigner: false, isWritable: true },
          { pubkey: MARKET, isSigner: false, isWritable: false },
          { pubkey: oracle, isSigner: false, isWritable: false },
          { pubkey: KLEND, isSigner: false, isWritable: false },
          { pubkey: KLEND, isSigner: false, isWritable: false },
          { pubkey: KLEND, isSigner: false, isWritable: false },
        ]});
      }

      // Pass ALL reserves the obligation has positions in
      const obligationReserves = findObligationReserves(Buffer.from(obInfo.data));
      tx.add({ programId: KLEND, data: DISC.refresh_obligation, keys: [
        { pubkey: MARKET, isSigner: false, isWritable: false },
        { pubkey: obPda, isSigner: false, isWritable: true },
        ...obligationReserves.map(r => ({ pubkey: r, isSigner: false, isWritable: false })),
      ]});

      const usdcAtaInfo = await connection.getAccountInfo(userUsdcAta);
      if (!usdcAtaInfo) {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userUsdcAta, publicKey, USDC_MINT));
      }

      const amtBuf = Buffer.alloc(8);
      amtBuf.writeBigUInt64LE(amountLamports, 0);
      tx.add({ programId: KLEND, data: Buffer.concat([DISC.borrow_obligation_liquidity, amtBuf]), keys: [
        { pubkey: publicKey, isSigner: true, isWritable: false },
        { pubkey: obPda, isSigner: false, isWritable: true },
        { pubkey: MARKET, isSigner: false, isWritable: false },
        { pubkey: lma, isSigner: false, isWritable: false },
        { pubkey: USDC_RESERVE, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: usdcLiqSupply, isSigner: false, isWritable: true },
        { pubkey: usdcFeeRecv, isSigner: false, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        { pubkey: KLEND, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ]});

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = publicKey;

      setStatus({ msg: "Sign borrow transaction...", type: "info" });
      const sig = await signAndSend(tx);
      setStatus({ msg: `Borrowed ${amount} USDC (tx: ${sig.slice(0, 16)}...)`, type: "success" });
      setAmount("");
      await loadPosition(); // Refresh
    } catch (e: any) {
      setStatus({ msg: `Failed: ${e.message?.slice(0, 120)}`, type: "error" });
    } finally {
      setLoading(false);
    }
  }

  const p = position;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Borrow USDC</h2>
        <p className="text-base-content/50 text-sm mt-1">
          Borrow Solstice USDC against your deposited deUSX collateral.
        </p>
      </div>

      {/* Position Summary */}
      {loadingPosition ? (
        <div className="flex justify-center py-4"><span className="loading loading-spinner" /></div>
      ) : p ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body p-4 gap-1">
              <div className="text-xs opacity-50">Collateral</div>
              <div className="font-mono font-bold">{p.collateralDeposited.toFixed(2)} deUSX</div>
              <div className="text-xs opacity-40">${p.collateralValueUsd.toFixed(2)}</div>
            </div>
          </div>
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body p-4 gap-1">
              <div className="text-xs opacity-50">Max Borrow</div>
              <div className="font-mono font-bold text-primary">${p.maxBorrowUsd.toFixed(2)}</div>
              <div className="text-xs opacity-40">LTV {p.ltvPct}%</div>
            </div>
          </div>
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body p-4 gap-1">
              <div className="text-xs opacity-50">Current Borrows</div>
              <div className="font-mono font-bold text-warning">${p.borrowedUsdc.toFixed(2)}</div>
              <div className="text-xs opacity-40">USDC</div>
            </div>
          </div>
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body p-4 gap-1">
              <div className="text-xs opacity-50">Available</div>
              <div className="font-mono font-bold text-success">${p.availableToBorrow.toFixed(2)}</div>
              <div className="text-xs opacity-40">can borrow</div>
            </div>
          </div>
          <div className="card bg-base-200 border border-base-300">
            <div className="card-body p-4 gap-1">
              <div className="text-xs opacity-50">Health Factor</div>
              <div className={`font-mono font-bold ${p.healthFactor === null ? "opacity-40" : p.healthFactor > 1.5 ? "text-success" : p.healthFactor > 1.1 ? "text-warning" : "text-error"}`}>
                {p.healthFactor !== null ? p.healthFactor.toFixed(2) : "—"}
              </div>
              <div className="text-xs opacity-40">{p.healthFactor !== null && p.healthFactor < 1.1 ? "⚠️ at risk" : "liq @ 1.0"}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="alert alert-info text-sm">No obligation found. Deposit collateral first.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Borrow Card */}
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-6 gap-4">
            <h3 className="card-title">Borrow USDC</h3>

            <div className="flex gap-2">
              <input
                className="input input-bordered bg-base-300 text-base-content flex-1 font-mono"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
              />
              <button
                className="btn btn-ghost btn-sm self-center"
                onClick={() => p && setAmount(Math.floor(p.availableToBorrow * 100) / 100 + "")}
              >
                MAX
              </button>
            </div>

            {/* Preview */}
            {amount && p && parseFloat(amount) > 0 && (
              <div className="bg-base-300 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="opacity-50">New borrow total</span>
                  <span className="font-mono">${(p.borrowedUsdc + parseFloat(amount)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-50">New health factor</span>
                  <span className={`font-mono ${
                    p.collateralValueUsd * (p.liqThreshPct / 100) / (p.borrowedUsdc + parseFloat(amount)) > 1.5 ? "text-success" :
                    p.collateralValueUsd * (p.liqThreshPct / 100) / (p.borrowedUsdc + parseFloat(amount)) > 1.1 ? "text-warning" : "text-error"
                  }`}>
                    {(p.collateralValueUsd * (p.liqThreshPct / 100) / (p.borrowedUsdc + parseFloat(amount))).toFixed(2)}
                  </span>
                </div>
                {parseFloat(amount) > p.availableToBorrow && (
                  <div className="text-error font-semibold">Exceeds borrow capacity!</div>
                )}
              </div>
            )}

            <button
              className="btn btn-warning w-full"
              onClick={handleBorrow}
              disabled={loading || !amount || parseFloat(amount) <= 0 || !p || parseFloat(amount) > p.availableToBorrow}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : "Borrow USDC"}
            </button>

            {status && (
              <div className={`alert ${status.type === "success" ? "alert-success" : status.type === "error" ? "alert-error" : "alert-info"} text-sm`}>
                {status.msg}
              </div>
            )}
          </div>
        </div>

        {/* Details Card */}
        <div className="card bg-base-200 border border-base-300">
          <div className="card-body p-6 gap-3">
            <h3 className="card-title">Market Parameters</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="opacity-50">Borrow Asset</span>
                <span className="font-mono">Solstice USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-50">Pool Liquidity</span>
                <span className="font-mono">{p ? p.usdcLiquidity.toFixed(2) : "..."} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-50">Collateral Price</span>
                <span className="font-mono">${p ? p.collateralPrice.toFixed(4) : "..."}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-50">LTV</span>
                <span className="font-mono">{p ? p.ltvPct : "..."}%</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-50">Liquidation Threshold</span>
                <span className="font-mono">{p ? p.liqThreshPct : "..."}%</span>
              </div>
              <div className="divider my-1"></div>
              <div className="flex justify-between">
                <span className="opacity-50">Collateral Yield</span>
                <span className="font-mono text-success">~8-12% APY</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-success">Net Carry</span>
                <span className="font-mono text-success">~+5-10% APY</span>
              </div>
            </div>

            <div className="alert alert-warning text-xs mt-2">
              Borrowing creates debt. Health factor below 1.0 triggers liquidation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
