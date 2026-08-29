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

// USD→AUD spot rate, cached for 10 minutes. Everything in the app reports
// in AUD; quotes in other currencies are converted on the way in.
let audRateCache: { rate: number; fetchedAt: number } | null = null;

export async function getUsdToAudRate(): Promise<number | null> {
  if (audRateCache && Date.now() - audRateCache.fetchedAt < 10 * 60 * 1000) {
    return audRateCache.rate;
  }
  try {
    const yahooFinance = await getYahoo();
    const result: any = await yahooFinance.quote("AUD=X");
    if (result?.regularMarketPrice) {
      audRateCache = { rate: result.regularMarketPrice, fetchedAt: Date.now() };
      return audRateCache.rate;
    }
  } catch {
    // fall through
  }
  return audRateCache?.rate ?? null;
}

export async function getQuote(ticker: string): Promise<QuoteResult | null> {
  try {
    const yahooFinance = await getYahoo();
    const result: any = await yahooFinance.quote(normaliseTicker(ticker));
    if (!result || !result.regularMarketPrice) return null;

    // Convert USD-quoted instruments to AUD so the whole app is one currency.
    let fx = 1;
    const quoteCurrency = result.currency || "AUD";
    if (quoteCurrency === "USD") {
      const rate = await getUsdToAudRate();
      if (rate) fx = rate;
    }

    return {
      price: result.regularMarketPrice * fx,
      currency: fx !== 1 ? "AUD" : quoteCurrency,
      changePercent: result.regularMarketChangePercent || 0,
      dayHigh: (result.regularMarketDayHigh || result.regularMarketPrice) * fx,
      dayLow: (result.regularMarketDayLow || result.regularMarketPrice) * fx,
      marketCap: result.marketCap ? result.marketCap * fx : null,
      dividendYield: result.trailingAnnualDividendYield
        ? result.trailingAnnualDividendYield * 100
        : null,
      annualDividend: result.trailingAnnualDividendRate
        ? result.trailingAnnualDividendRate * fx
        : null,
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
      interval: "1d",
      events: "div",
    });

    const raw = result?.events?.dividends;
    const dividendEvents: any[] = Array.isArray(raw)
      ? raw
      : raw
        ? Object.values(raw)
        : [];
    return dividendEvents
      .filter((d: any) => d && d.date && d.amount)
      .map((d: any) => ({
        date: new Date(d.date),
        amount: d.amount,
      }));
  } catch {
    return [];
  }
}

// Daily close series per ticker over [from, to], converted to AUD (USD series
// use the forward-filled USD/AUD rate). Used for period-movement calculations.
export async function getDailySeriesAUD(
  tickers: string[],
  from: Date,
  to: Date
): Promise<Record<string, { date: string; close: number }[]>> {
  const out: Record<string, { date: string; close: number }[]> = {};
  if (tickers.length === 0) return out;

  const yahooFinance = await getYahoo();
  const currencyByTicker: Record<string, string> = {};

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const result: any = await yahooFinance.chart(normaliseTicker(ticker), {
          period1: from,
          period2: to,
          interval: "1d",
        });
        const quotes = (result?.quotes || [])
          .filter((q: any) => q.close !== null && q.close !== undefined)
          .map((q: any) => ({
            date: new Date(q.date).toISOString().slice(0, 10),
            close: q.close as number,
          }));
        if (quotes.length > 0) {
          out[ticker] = quotes;
          currencyByTicker[ticker] = result?.meta?.currency || "AUD";
        }
      } catch {
        // No history for this ticker in the window.
      }
    })
  );

  // Convert USD-denominated series to AUD using the historical rate.
  const usdTickers = Object.keys(out).filter((t) => currencyByTicker[t] === "USD");
  if (usdTickers.length > 0) {
    try {
      const fxResult: any = await yahooFinance.chart("AUD=X", {
        period1: from,
        period2: to,
        interval: "1d",
      });
      const fxSeries = (fxResult?.quotes || [])
        .filter((q: any) => q.close !== null && q.close !== undefined)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().slice(0, 10),
          close: q.close as number,
        }));
      if (fxSeries.length > 0) {
        const fxMap = new Map<string, number>(
          fxSeries.map((q: { date: string; close: number }) => [q.date, q.close])
        );
        const fxDates = fxSeries.map((q: { date: string }) => q.date).sort();
        const rateAt = (date: string): number => {
          if (fxMap.has(date)) return fxMap.get(date)!;
          let last = fxSeries[0].close;
          for (const d of fxDates) {
            if (d > date) break;
            last = fxMap.get(d)!;
          }
          return last;
        };
        for (const t of usdTickers) {
          out[t] = out[t].map((q) => ({ date: q.date, close: q.close * rateAt(q.date) }));
        }
      }
    } catch {
      // If FX history is unavailable the USD series stays unconverted.
    }
  }

  return out;
}

export { EXCHANGE_SUFFIXES };
