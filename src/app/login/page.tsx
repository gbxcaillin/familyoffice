"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Login failed");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gbx-void flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-12">
          <div className="inline-block border border-gbx-teal/40 px-8 py-5 mb-6">
            <h1 className="font-heading text-4xl font-light text-gbx-teal tracking-wide">
              GBX
            </h1>
            <div className="w-8 h-px bg-gbx-teal/40 mx-auto my-2" />
            <p className="text-[10px] text-gbx-teal/70 tracking-[0.3em] uppercase font-body font-medium">
              Family Office
            </p>
          </div>
          <p className="text-white/40 text-sm font-body">
            Private financial dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[11px] text-white/50 uppercase tracking-[0.15em] font-body font-medium mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gbx-charcoal border border-white/10 text-white px-4 py-3 text-sm font-body focus:outline-none focus:border-gbx-teal/50 transition-colors"
              placeholder="Enter your name"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] text-white/50 uppercase tracking-[0.15em] font-body font-medium mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gbx-charcoal border border-white/10 text-white px-4 py-3 text-sm font-body focus:outline-none focus:border-gbx-teal/50 transition-colors"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm font-body">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gbx-teal text-white py-3 text-sm font-body font-medium uppercase tracking-[0.15em] hover:bg-gbx-deep-teal transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
