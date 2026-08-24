/* eslint-disable @typescript-eslint/no-explicit-any */

interface QuoteResult {
  price: number;
  currency: string;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  marketCap: number | null;
  dividendYield: number | null;
  annualDividend: number | null;
  name: string;
  exchange: string;
}

interface DividendEvent {
  date: Date;
  amount: number;
}

const EXCHANGE_SUFFIXES: Record<string, string> = {
  ASX: ".AX",
  NYSE: "",
  NASDAQ: "",
  LSE: ".L",
  TSX: ".TO",
  HKG: ".HK",
  SGX: ".SI",
};

export function normaliseTicker(ticker: string): string {
  const upper = ticker.toUpperCase().trim();
  if (upper.includes(".") || upper.includes(":")) return upper;
  return upper;
}

export async function getQuote(ticker: string): Promise<QuoteResult | null> {
  try {
    const { default: yahooFinance } = await import("yahoo-finance2");
    const result: any = await yahooFinance.quote(normaliseTicker(ticker));
    if (!result || !result.regularMarketPrice) return null;

    return {
      price: result.regularMarketPrice,
      currency: result.currency || "AUD",
      changePercent: result.regularMarketChangePercent || 0,
      dayHigh: result.regularMarketDayHigh || result.regularMarketPrice,
      dayLow: result.regularMarketDayLow || result.regularMarketPrice,
      marketCap: result.marketCap || null,
      dividendYield: result.trailingAnnualDividendYield
        ? result.trailingAnnualDividendYield * 100
        : null,
      annualDividend: result.trailingAnnualDividendRate || null,
      name: result.shortName || result.longName || ticker,
      exchange: result.fullExchangeName || result.exchange || "",
    };
  } catch {
    return null;
  }
}

export async function getQuotes(
  tickers: string[]
): Promise<Record<string, QuoteResult>> {
  const results: Record<string, QuoteResult> = {};
  const batchSize = 10;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const promises = batch.map(async (ticker) => {
      const quote = await getQuote(ticker);
      if (quote) results[ticker] = quote;
    });
    await Promise.all(promises);
  }

  return results;
}

export async function getDividendHistory(
  ticker: string,
  fromDate?: Date
): Promise<DividendEvent[]> {
  try {
    const { default: yahooFinance } = await import("yahoo-finance2");
    const period1 = fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result: any[] = await yahooFinance.historical(normaliseTicker(ticker), {
      period1,
      events: "dividends",
    });

    return (result || []).map((d: any) => ({
      date: d.date,
      amount: d.adjClose || 0,
    }));
  } catch {
    return [];
  }
}

export { EXCHANGE_SUFFIXES };
