import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

interface KycGateProps {
  onRegister: () => Promise<string | undefined>;
}

const COMPLIANCE_API = import.meta.env.VITE_COMPLIANCE_API || "https://stablehacks-backend-edge.achim-d87.workers.dev";

export function KycGate({ onRegister }: KycGateProps) {
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<"idle" | "civic" | "registering" | "backend" | "error">("idle");
  const [error, setError] = useState<string>("");

  // Try Civic first, then fall back to backend
  const handleCivicVerify = useCallback(async () => {
    setStatus("civic");
    setError("");
    try {
      // Try self_register (requires gateway token)
      setStatus("registering");
      await onRegister();
    } catch (e: any) {
      // Civic failed — offer backend fallback
      setError(`Civic verification failed: ${e.message?.slice(0, 80)}. Try the alternative below.`);
      setStatus("error");
    }
  }, [onRegister]);

  // Backend-powered verification (works without Civic)
  const handleBackendVerify = useCallback(async () => {
    if (!publicKey) return;
    setStatus("backend");
    setError("");
    try {
      // Submit
      const submitResp = await fetch(`${COMPLIANCE_API}/kyc/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          entityType: "individual",
          name: "Retail User",
          email: "user@delta.savings",
        }),
      });
      if (!submitResp.ok) {
        const err = await submitResp.json().catch(() => ({ error: "Submit failed" }));
        throw new Error(err.error || "Submit failed");
      }

      // Approve
      const approveResp = await fetch(`${COMPLIANCE_API}/kyc/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      });
      if (!approveResp.ok) {
        const err = await approveResp.json().catch(() => ({ error: "Approval failed" }));
        throw new Error(err.error || "Approval failed");
      }

      const data = await approveResp.json() as any;
      if (data.data?.status === "approved" || data.message?.includes("approved")) {
        // Approved via backend — store in session and reload
        sessionStorage.setItem(`kyc_retail_${publicKey.toBase58()}`, "approved");
        window.location.reload();
        return;
      }
      throw new Error("Approval did not return approved status");
    } catch (e: any) {
      setError(e.message?.slice(0, 100) || "Verification failed");
      setStatus("error");
    }
  }, [publicKey, onRegister]);

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body items-center text-center py-10 px-8">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 text-primary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <h2 className="card-title text-2xl font-bold mb-2">Identity Verification</h2>
        <p className="text-sm opacity-60 max-w-md mb-6 leading-relaxed">
          To protect all participants, deposits require a one-time identity
          verification. This takes about 30 seconds.
        </p>

        <div className="flex flex-col gap-3 max-w-sm w-full mb-7 text-left">
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">1</span>
            <span>Verify your identity</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">2</span>
            <span>On-chain whitelist registration</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">3</span>
            <span>Start earning yield</span>
          </div>
        </div>

        {/* Primary: Backend verification (reliable on devnet) */}
        <button
          onClick={handleBackendVerify}
          disabled={status === "backend" || status === "registering"}
          className="btn btn-primary btn-lg px-10 mb-2"
        >
          {status === "backend" ? (
            <><span className="loading loading-spinner loading-sm" /> Verifying...</>
          ) : (
            "Verify Identity"
          )}
        </button>

        {/* Secondary: Civic (may not work on devnet) */}
        <button
          onClick={handleCivicVerify}
          disabled={status === "civic" || status === "registering" || status === "backend"}
          className="btn btn-ghost btn-sm opacity-50 mb-4"
        >
          {status === "civic" || status === "registering" ? (
            <><span className="loading loading-spinner loading-xs" /> Processing...</>
          ) : (
            "Or verify with Civic Pass"
          )}
        </button>

        {error && (
          <div className="alert alert-error text-xs max-w-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs opacity-40 mt-2">
          Your identity is verified through our compliance backend.
          No personal data is stored on-chain.
        </p>
      </div>
    </div>
  );
}
