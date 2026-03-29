import { useState, useCallback } from "react";
import { useGateway } from "@civic/solana-gateway-react";

interface KycGateProps {
  onRegister: () => Promise<string | undefined>;
}

export function KycGate({ onRegister }: KycGateProps) {
  const [status, setStatus] = useState<"idle" | "civic" | "registering" | "error">("idle");
  const [error, setError] = useState<string>("");
  const { requestGatewayToken, gatewayStatus, gatewayToken } = useGateway();

  const handleCivicVerify = useCallback(async () => {
    setStatus("civic");
    setError("");
    try {
      // Step 1: Request Civic Pass (opens embedded modal)
      await requestGatewayToken();
      // If we get here, the user has a gateway token
      // Step 2: Register on-chain via self_register
      setStatus("registering");
      await onRegister();
    } catch (e: any) {
      // User may have cancelled the Civic flow
      if (e.message?.includes("cancelled") || e.message?.includes("closed")) {
        setStatus("idle");
        return;
      }
      setError(e.message?.slice(0, 120) || "Verification failed");
      setStatus("error");
    }
  }, [requestGatewayToken, onRegister]);

  // If user already has a gateway token, just register
  const handleDirectRegister = useCallback(async () => {
    setStatus("registering");
    setError("");
    try {
      await onRegister();
    } catch (e: any) {
      setError(e.message?.slice(0, 120) || "Registration failed");
      setStatus("error");
    }
  }, [onRegister]);

  const hasGatewayToken = !!gatewayToken;

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body items-center text-center py-10 px-8">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 text-primary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <h2 className="card-title text-2xl font-bold mb-2">Identity Verification</h2>
        <p className="text-sm opacity-60 max-w-md mb-6 leading-relaxed">
          To protect all participants, deposits require a one-time identity
          verification powered by Civic. This takes about 2 minutes.
        </p>

        <div className="flex flex-col gap-3 max-w-sm w-full mb-7 text-left">
          <div className="flex items-center gap-3 text-sm">
            <span className={`badge ${hasGatewayToken ? "badge-success" : "badge-primary"} badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0`}>
              {hasGatewayToken ? "✓" : "1"}
            </span>
            <span className={hasGatewayToken ? "line-through opacity-50" : ""}>
              Complete liveness check with Civic
            </span>
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

        {hasGatewayToken ? (
          <button
            onClick={handleDirectRegister}
            disabled={status === "registering"}
            className="btn btn-success btn-lg px-10 mb-4"
          >
            {status === "registering" ? (
              <><span className="loading loading-spinner loading-sm" /> Registering on-chain...</>
            ) : (
              "Complete Registration"
            )}
          </button>
        ) : (
          <button
            onClick={handleCivicVerify}
            disabled={status === "civic" || status === "registering"}
            className="btn btn-primary btn-lg px-10 mb-4"
          >
            {status === "civic" ? (
              <><span className="loading loading-spinner loading-sm" /> Opening Civic Pass...</>
            ) : status === "registering" ? (
              <><span className="loading loading-spinner loading-sm" /> Registering...</>
            ) : (
              "Verify with Civic"
            )}
          </button>
        )}

        {error && (
          <div className="alert alert-error text-xs max-w-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs opacity-40 mt-4">
          Powered by Civic — no admin approval needed. Your identity data is
          verified by Civic and never stored on-chain.
        </p>
      </div>
    </div>
  );
}
