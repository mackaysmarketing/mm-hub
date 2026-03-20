"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPortalMode, getAllowedAuthMethods } from "@/lib/subdomain";
import { MackaysLogo } from "@/components/mackays-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function MicrosoftIcon() {
  return (
    <svg
      className="mr-2 h-4 w-4"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mode = useMemo(
    () => getPortalMode(typeof window !== "undefined" ? window.location.hostname : "localhost"),
    []
  );
  const authMethods = getAllowedAuthMethods(mode);

  async function handleMicrosoftSignIn() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: window.location.origin + "/callback",
      },
    });
    if (error) {
      setError(error.message);
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/callback");
    router.refresh();
  }

  // --- GROWER MODE: email/password only ---
  if (mode === "grower") {
    return (
      <div className="w-full rounded-xl border border-sand bg-warmwhite p-10 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <MackaysLogo width={200} className="mb-4" />
          <h1 className="font-display text-xl text-forest">Grower Portal</h1>
          <p className="mt-1 text-sm text-stone">
            Sign in to access your grower portal
          </p>
        </div>

        <form onSubmit={handlePasswordSignIn}>
          <div className="mb-4 space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="mb-2 space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="mb-4 text-right">
            <a href="#" className="text-sm text-canopy hover:underline">
              Forgot password?
            </a>
          </div>

          <Button
            type="submit"
            className="w-full bg-canopy text-white hover:bg-canopy-light"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {error && (
            <p className="mt-3 text-center text-sm text-blaze">{error}</p>
          )}
        </form>
      </div>
    );
  }

  // --- HUB MODE: Microsoft SSO only ---
  if (mode === "hub") {
    return (
      <div className="w-full rounded-xl border border-sand bg-warmwhite p-10 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <MackaysLogo width={200} className="mb-4" />
          <p className="mt-1 text-sm text-stone">
            Sign in with your Mackays account
          </p>
        </div>

        <Button
          type="button"
          className="w-full bg-[#2F2F2F] text-white hover:bg-[#1a1a1a]"
          onClick={handleMicrosoftSignIn}
        >
          <MicrosoftIcon />
          Sign in with Microsoft
        </Button>

        {error && (
          <p className="mt-3 text-center text-sm text-blaze">{error}</p>
        )}
      </div>
    );
  }

  // --- DEV MODE: both login options ---
  return (
    <div className="w-full rounded-xl border border-sand bg-warmwhite p-10 shadow-sm">
      {/* Header */}
      <div className="mb-8 flex flex-col items-center text-center">
        <MackaysLogo width={200} className="mb-4" />
        <h1 className="font-display text-xl text-forest">Welcome</h1>
        <p className="mt-1 text-sm text-stone">
          Sign in to access your portal
        </p>
      </div>

      {/* Section A — Mackays Staff */}
      {authMethods.microsoft && (
        <div className="mb-6">
          <p className="mb-3 text-xs uppercase tracking-wider text-clay">
            Mackays Staff
          </p>
          <Button
            type="button"
            className="w-full bg-[#2F2F2F] text-white hover:bg-[#1a1a1a]"
            onClick={handleMicrosoftSignIn}
          >
            <MicrosoftIcon />
            Sign in with Microsoft
          </Button>
        </div>
      )}

      {/* Divider */}
      {authMethods.microsoft && authMethods.email && (
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-sand" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-warmwhite px-3 text-clay">or</span>
          </div>
        </div>
      )}

      {/* Section B — Grower Access */}
      {authMethods.email && (
        <form onSubmit={handlePasswordSignIn}>
          <p className="mb-3 text-xs uppercase tracking-wider text-clay">
            Grower Access
          </p>

          <div className="mb-4 space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="mb-2 space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="mb-4 text-right">
            <a href="#" className="text-sm text-canopy hover:underline">
              Forgot password?
            </a>
          </div>

          <Button
            type="submit"
            className="w-full bg-canopy text-white hover:bg-canopy-light"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {error && (
            <p className="mt-3 text-center text-sm text-blaze">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}
