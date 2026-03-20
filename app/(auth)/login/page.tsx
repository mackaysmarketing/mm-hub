"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="w-full rounded-xl border border-sand bg-warmwhite p-10 shadow-sm">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mb-4 font-display text-2xl font-bold text-forest">
          MACKAYS
        </div>
        <h1 className="font-display text-xl text-forest">Welcome</h1>
        <p className="mt-1 text-sm text-stone">
          Sign in to access your portal
        </p>
      </div>

      {/* Section A — Mackays Staff */}
      <div className="mb-6">
        <p className="mb-3 text-xs uppercase tracking-wider text-clay">
          Mackays Staff
        </p>
        <Button
          type="button"
          className="w-full bg-[#2F2F2F] text-white hover:bg-[#1a1a1a]"
          onClick={handleMicrosoftSignIn}
        >
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
          Sign in with Microsoft
        </Button>
      </div>

      {/* Divider */}
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-sand" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-warmwhite px-3 text-clay">or</span>
        </div>
      </div>

      {/* Section B — Grower Access */}
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
    </div>
  );
}
