import { NextResponse } from "next/server";
import getDb from "@/lib/db";

interface LoanRow {
  id: string;
  name: string;
  institution: string | null;
  interest_rate: number;
  repayment_amount: number;
  redraw_available: number | null;
  balance: number | null;
}

interface Scenario {
  extra: number;
  months: number;
  payoffDate: string;
  totalInterest: number;
}

// Closed-form amortisation: months to zero at a fixed monthly repayment.
function amortise(
  balance: number,
  annualRatePercent: number,
  monthlyPayment: number
): { months: number; totalInterest: number } | null {
  const r = annualRatePercent / 100 / 12;
  if (balance <= 0 || monthlyPayment <= 0) return null;
  if (r <= 0) {
    const months = balance / monthlyPayment;
    return { months, totalInterest: 0 };
  }
  if (monthlyPayment <= balance * r) return null; // repayment doesn't cover interest
  const months = -Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r);
  const totalPaid = monthlyPayment * months;
  return { months, totalInterest: totalPaid - balance };
}

function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const db = getDb();

  const loans = db
    .prepare(
      `SELECT a.id, a.name, a.institution, a.interest_rate, a.repayment_amount, a.redraw_available,
        (SELECT b.balance FROM balances b WHERE b.account_id = a.id ORDER BY b.date DESC LIMIT 1) as balance
       FROM accounts a
       WHERE a.type = 'loan' AND a.interest_rate IS NOT NULL AND a.repayment_amount IS NOT NULL`
    )
    .all() as LoanRow[];

  const results = loans
    .map((loan) => {
      const owing = Math.abs(loan.balance || 0);
      if (owing === 0) return null;

      const scenarios: Scenario[] = [];
      for (const extra of [0, 100, 250, 500, 1000]) {
        const result = amortise(
          owing,
          loan.interest_rate,
          loan.repayment_amount + extra
        );
        if (result) {
          scenarios.push({
            extra,
            months: result.months,
            payoffDate: addMonths(result.months),
            totalInterest: result.totalInterest,
          });
        }
      }
      if (scenarios.length === 0) return null;

      return {
        id: loan.id,
        name: loan.name,
        institution: loan.institution,
        balance: owing,
        interestRate: loan.interest_rate,
        repayment: loan.repayment_amount,
        monthlyInterest: (owing * loan.interest_rate) / 100 / 12,
        redrawAvailable: loan.redraw_available,
        scenarios,
      };
    })
    .filter(Boolean);

  return NextResponse.json(results);
}
