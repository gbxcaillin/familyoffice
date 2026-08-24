/* eslint-disable @typescript-eslint/no-explicit-any */

// yahoo-finance2 v4 requires an instantiated client; share one per process.
let yahooInstance: any = null;

export async function getYahoo(): Promise<any> {
  if (!yahooInstance) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    yahooInstance = new (YahooFinance as any)({
      suppressNotices: ["yahooSurvey"],
    });
  }
  return yahooInstance;
}

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
    const yahooFinance = await getYahoo();
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
    const yahooFinance = await getYahoo();
    const period1 = fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result: any = await yahooFinance.chart(normaliseTicker(ticker), {
      period1,
      events: "dividends",
    });

    const dividendEvents = result?.events?.dividends || [];
    return dividendEvents.map((d: any) => ({
      date: new Date(d.date),
      amount: d.amount || 0,
    }));
  } catch {
    return [];
  }
}

export { EXCHANGE_SUFFIXES };
