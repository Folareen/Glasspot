"use client";

import { useState } from "react";

type HealthStatus = {
  status: string;
  db: string;
};

export default function Home() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function checkHealth() {
    setIsChecking(true);
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${apiUrl}/health`);
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      setHealth(await response.json());
    } catch {
      setHealth(null);
      setError("Could not reach the backend.");
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Welcome to Glasspot
      </h1>

      <button
        onClick={checkHealth}
        disabled={isChecking}
        className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {isChecking ? "Checking..." : "Check backend health"}
      </button>

      {health && (
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          API: {health.status} · DB: {health.db}
        </p>
      )}
      {error && <p className="text-base text-red-600">{error}</p>}
    </div>
  );
}
