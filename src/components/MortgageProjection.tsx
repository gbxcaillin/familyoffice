"use client";

import { useEffect, useState } from "react";

interface Scenario {
  extra: number;
  months: number;
  payoffDate: string;
  totalInterest: number;
}

interface Loan {
  id: string;
  name: string;
  institution: string | null;
  balance: number;
  interestRate: number;
  repayment: number;
  monthlyInterest: number;
  redrawAvailable: number | null;
  scenarios: Scenario[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatYears(months: number): string {
  const years = Math.floor(months / 12);
  const rem = Math.round(months % 12);
  if (rem === 0) return `${years}y`;
  return `${years}y ${rem}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-AU", {
    month: "short",
    year: "numeric",
  });
}

// Same closed-form amortisation the API uses, for the custom-amount input.
function amortise(
  balance: number,
  annualRatePercent: number,
  monthlyPayment: number
): { months: number; totalInterest: number } | null {
  const r = annualRatePercent / 100 / 12;
  if (balance <= 0 || monthlyPayment <= 0) return null;
  if (r <= 0) return { months: balance / monthlyPayment, totalInterest: 0 };
  if (monthlyPayment <= balance * r) return null;
  const months = -Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r);
  return { months, totalInterest: monthlyPayment * months - balance };
}

function payoffDateFromMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d.toISOString().slice(0, 10);
}

export default function MortgageProjection() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [customExtra, setCustomExtra] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/mortgage")
      .then((r) => r.json())
      .then((data) => setLoans(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  if (loans.length === 0) return null;

  return (
    <>
      {loans.map((loan) => {
        const base = loan.scenarios.find((s) => s.extra === 0);
        const extraValue = parseFloat(customExtra[loan.id] || "");
        const custom =
          base && extraValue > 0
            ? amortise(loan.balance, loan.interestRate, loan.repayment + extraValue)
            : null;
        return (
          <div key={loan.id} className="bg-white border border-gbx-border p-4 sm:p-6">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-teal">
                Mortgage Projection — {loan.name}
              </h2>
              <p className="text-xs text-gbx-muted font-data">
                {formatCurrency(loan.balance)} @ {loan.interestRate}% ·{" "}
                {formatCurrency(loan.repayment)}/mo
              </p>
            </div>

            {base && (
              <div
                className={`grid gap-3 sm:gap-4 mb-5 ${
                  loan.redrawAvailable ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
                }`}
              >
                <div>
                  <p className="text-[10px] uppercase tracking-[0.15em] font-body text-gbx-muted mb-1">
                    Paid Off
                  </p>
                  <p className="font-data text-sm sm:text-lg text-gbx-charcoal">
                    {formatDate(base.payoffDate)}
                  </p>
                  <p className="text-[11px] text-gbx-muted font-data">
                    {formatYears(base.months)} to go
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.15em] font-body text-gbx-muted mb-1">
                    Interest Remaining
                  </p>
                  <p className="font-data text-sm sm:text-lg text-red-600">
                    {formatCurrency(base.totalInterest)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.15em] font-body text-gbx-muted mb-1">
                    Interest / Month
                  </p>
                  <p className="font-data text-sm sm:text-lg text-gbx-charcoal">
                    {formatCurrency(loan.monthlyInterest)}
                  </p>
                </div>
                {loan.redrawAvailable !== null && loan.redrawAvailable > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.15em] font-body text-gbx-muted mb-1">
                      Ahead of Schedule
                    </p>
                    <p className="font-data text-sm sm:text-lg text-gbx-teal">
                      +{formatCurrency(loan.redrawAvailable)}
                    </p>
                    <p className="text-[11px] text-gbx-muted font-data">
                      available to redraw
                    </p>
                  </div>
                )}
              </div>
            )}

            {base && loan.scenarios.length > 1 && (
              <div className="border-t border-gbx-border pt-4">
                <p className="text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-3">
                  Extra Repayment Scenarios
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gbx-border">
                        {["Extra / Month", "Paid Off", "Time Saved", "Interest Saved"].map(
                          (h) => (
                            <th
                              key={h}
                              className="px-2 sm:px-4 py-2 text-left text-[10px] uppercase tracking-[0.1em] font-body font-medium text-gbx-muted"
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {loan.scenarios
                        .filter((s) => s.extra > 0)
                        .map((s) => (
                          <tr
                            key={s.extra}
                            className="border-b border-gbx-border/50"
                          >
                            <td className="px-2 sm:px-4 py-2 font-data text-sm text-gbx-charcoal">
                              +{formatCurrency(s.extra)}
                            </td>
                            <td className="px-2 sm:px-4 py-2 font-data text-sm text-gbx-charcoal">
                              {formatDate(s.payoffDate)}
                            </td>
                            <td className="px-2 sm:px-4 py-2 font-data text-sm text-gbx-teal">
                              {formatYears(base.months - s.months)}
                            </td>
                            <td className="px-2 sm:px-4 py-2 font-data text-sm text-gbx-teal">
                              {formatCurrency(base.totalInterest - s.totalInterest)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.15em] font-body font-medium text-gbx-muted mb-1.5">
                      Try your own extra ($/month)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={customExtra[loan.id] || ""}
                      onChange={(e) =>
                        setCustomExtra((c) => ({ ...c, [loan.id]: e.target.value }))
                      }
                      placeholder="e.g. 750"
                      className="w-36 bg-white border border-gbx-border px-3 py-2 text-sm font-data text-gbx-charcoal focus:outline-none focus:border-gbx-teal transition-colors"
                    />
                  </div>
                  {base && custom && (
                    <div className="flex-1 min-w-[240px] bg-gbx-soft/60 border border-gbx-border px-4 py-2.5">
                      <p className="text-sm font-body text-gbx-charcoal">
                        <span className="font-data text-gbx-teal">
                          +{formatCurrency(extraValue)}/mo
                        </span>{" "}
                        pays it off{" "}
                        <span className="font-data">
                          {formatDate(payoffDateFromMonths(custom.months))}
                        </span>{" "}
                        — saves{" "}
                        <span className="font-data text-gbx-teal">
                          {formatYears(base.months - custom.months)}
                        </span>{" "}
                        and{" "}
                        <span className="font-data text-gbx-teal">
                          {formatCurrency(base.totalInterest - custom.totalInterest)}
                        </span>{" "}
                        in interest
                      </p>
                    </div>
                  )}
                  {base && extraValue > 0 && !custom && (
                    <p className="text-sm text-red-600 font-body">
                      That amount doesn&apos;t change the result — check the figure.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
