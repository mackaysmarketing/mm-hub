import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-parchment px-4">
      <div className="w-full max-w-md rounded-xl border border-sand bg-warmwhite p-8 text-center shadow-sm">
        <h1 className="font-display text-4xl font-bold text-forest">404</h1>
        <h2 className="mt-2 font-display text-lg font-bold text-soil">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-stone">
          The page you&apos;re looking for doesn&apos;t exist or you
          don&apos;t have access.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-canopy px-6 py-2.5 text-sm font-medium text-white transition hover:bg-canopy-light"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
