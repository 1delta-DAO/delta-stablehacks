import { useState } from "react";

interface KycGateProps {
  onRegister: () => Promise<string | undefined>;
}

export function KycGate({ onRegister }: KycGateProps) {
  const [status, setStatus] = useState<"idle" | "registering" | "error">("idle");
  const [error, setError] = useState<string>("");

  const handleVerify = async () => {
    setStatus("registering");
    setError("");
    try {
      await onRegister();
    } catch (e: any) {
      setError(e.message?.slice(0, 120) || "Registration failed");
      setStatus("error");
    }
  };

  return (
    <div className="card bg-base-200 border border-base-300 shadow-xl">
      <div className="card-body items-center text-center py-10 px-8">
        <div className="text-5xl mb-4">&#128274;</div>
        <h2 className="card-title text-2xl font-bold mb-2">Identity Verification Required</h2>
        <p className="text-sm opacity-60 max-w-md mb-6 leading-relaxed">
          To protect all participants, deposits require a one-time identity
          verification. This takes about 2 minutes and your data is handled by
          Civic, a trusted identity provider.
        </p>

        <div className="flex flex-col gap-3 max-w-sm w-full mb-7 text-left">
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">1</span>
            <span>Get a Civic Pass at <a href="https://getpass.civic.com" target="_blank" rel="noreferrer" className="link link-primary">getpass.civic.com</a></span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">2</span>
            <span>Complete the liveness check</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="badge badge-primary badge-lg w-7 h-7 rounded-full font-bold text-sm shrink-0">3</span>
            <span>Return here and click "Register" below</span>
          </div>
        </div>

        <button
          onClick={handleVerify}
          disabled={status === "registering"}
          className={`btn btn-primary btn-lg px-10 mb-4 ${status === "registering" ? "opacity-60" : ""}`}
        >
          {status === "registering" ? "Verifying..." : "Register with Civic Pass"}
        </button>

        {error && (
          <p className="text-error text-xs max-w-sm break-words">
            {error}
          </p>
        )}

        <p className="text-xs opacity-50 mt-4">
          Already have a Civic Pass? Click Register to complete on-chain
          verification. No admin approval needed.
        </p>
      </div>
    </div>
  );
}
