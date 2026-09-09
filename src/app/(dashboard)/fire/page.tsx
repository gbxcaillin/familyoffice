"use client";

import FreedomCard from "@/components/FreedomCard";
import ScenarioLab from "@/components/ScenarioLab";

export default function FirePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-light text-gbx-charcoal">
          FIRE &amp; Coast FIRE
        </h1>
        <p className="text-sm text-gbx-muted font-body mt-1">
          Your path to financial independence — and a sandbox to test different
          returns, drawdowns, savings and retirement ages
        </p>
      </div>

      <FreedomCard />
      <ScenarioLab />
    </div>
  );
}
