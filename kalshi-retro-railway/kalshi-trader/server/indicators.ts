// Technical indicators for trading signals

export function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calcEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    emas.push(prices[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9): MACDResult {
  if (prices.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signal);
  const last = prices.length - 1;
  return {
    macd: macdLine[last],
    signal: signalLine[last],
    histogram: macdLine[last] - signalLine[last],
  };
}

export interface SignalResult {
  direction: "up" | "down" | "neutral";
  confidence: number; // 0-100
  reasoning: string;
  rsi: number;
  macd: number;
  macdSignal: number;
}

// ── SWING DETECTION ────────────────────────────────────────────────────────
// Detects a sharp directional move over the last `lookback` ticks.
// Returns the swing strength as a signed percentage:
//   positive = up swing, negative = down swing, 0 = no swing
export function detectSwing(prices: number[], lookbackTicks: number, thresholdPct: number): number {
  if (prices.length < lookbackTicks + 1) return 0;
  const from = prices[prices.length - 1 - lookbackTicks];
  const to   = prices[prices.length - 1];
  if (from === 0) return 0;
  const changePct = ((to - from) / from) * 100;
  if (Math.abs(changePct) >= thresholdPct) return changePct;
  return 0;
}

// ── VELOCITY (rate of change per tick) ────────────────────────────────────
// Measures the acceleration: is the price moving faster over the most recent
// ticks than the prior period? Used to confirm a swing is strengthening.
export function calcVelocity(prices: number[], period = 3): number {
  if (prices.length < period * 2) return 0;
  const recent = prices.slice(-period);
  const prior  = prices.slice(-period * 2, -period);
  const recentMove = recent[recent.length - 1] - recent[0];
  const priorMove  = prior[prior.length - 1]  - prior[0];
  // positive = accelerating up, negative = accelerating down
  return recentMove - priorMove;
}

export function generateSignal(
  prices: number[],
  strategy: string,
  swingThreshold = 0.05,
  swingLookback = 3
): SignalResult {
  // ── SWING STRATEGY ──────────────────────────────────────────────────────
  // Pure price-action: react to sharp moves quickly without needing
  // a long history. Falls back to standard momentum if no swing.
  if (strategy === "swing") {
    const rsi = prices.length >= 15 ? calcRSI(prices, 14) : 50;
    const macdRes = prices.length >= 35 ? calcMACD(prices) : { macd: 0, signal: 0, histogram: 0 };

    if (prices.length < swingLookback + 1) {
      return {
        direction: "neutral",
        confidence: 0,
        reasoning: "Warming up swing detector…",
        rsi,
        macd: macdRes.macd,
        macdSignal: macdRes.signal,
      };
    }

    const swingPct = detectSwing(prices, swingLookback, swingThreshold);
    const velocity = calcVelocity(prices, swingLookback);

    if (swingPct === 0) {
      return {
        direction: "neutral",
        confidence: 0,
        reasoning: `No swing (threshold: ${swingThreshold}%)`,
        rsi,
        macd: macdRes.macd,
        macdSignal: macdRes.signal,
      };
    }

    // Build confidence: base on swing magnitude + velocity confirmation
    const swingMag = Math.abs(swingPct);
    // Each full threshold unit of swing → 20% confidence, capped at 90%
    let confidence = Math.min(90, (swingMag / swingThreshold) * 20);

    // Velocity confirmation: if price is still accelerating in same direction, boost
    const velAligned = (swingPct > 0 && velocity > 0) || (swingPct < 0 && velocity < 0);
    if (velAligned) confidence = Math.min(95, confidence + 10);

    // RSI sanity check: don't chase into extreme RSI (overbought/oversold fade risk)
    const reasons: string[] = [
      `Swing ${swingPct > 0 ? "+" : ""}${swingPct.toFixed(3)}% over ${swingLookback} ticks`,
      velAligned ? "velocity confirming" : "velocity diverging (caution)",
    ];
    if (rsi > 72 && swingPct > 0) {
      confidence = Math.max(0, confidence - 15);
      reasons.push(`RSI ${rsi.toFixed(0)} overbought — confidence reduced`);
    } else if (rsi < 28 && swingPct < 0) {
      confidence = Math.max(0, confidence - 15);
      reasons.push(`RSI ${rsi.toFixed(0)} oversold — confidence reduced`);
    } else {
      reasons.push(`RSI ${rsi.toFixed(0)}`);
    }

    return {
      direction: swingPct > 0 ? "up" : "down",
      confidence,
      reasoning: reasons.join(" | "),
      rsi,
      macd: macdRes.macd,
      macdSignal: macdRes.signal,
    };
  }

  // ── MOMENTUM STRATEGY (original) ────────────────────────────────────────
  if (prices.length < 27) {
    return {
      direction: "neutral",
      confidence: 0,
      reasoning: "Insufficient price history",
      rsi: 50,
      macd: 0,
      macdSignal: 0,
    };
  }

  const rsi = calcRSI(prices, 14);
  const { macd, signal, histogram } = calcMACD(prices);

  const recent = prices.slice(-5);
  const momentum = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;

  let upVotes = 0, downVotes = 0;
  const reasons: string[] = [];

  if (strategy === "momentum") {
    if (rsi > 55) { upVotes += 2; reasons.push(`RSI ${rsi.toFixed(0)} bullish`); }
    else if (rsi < 45) { downVotes += 2; reasons.push(`RSI ${rsi.toFixed(0)} bearish`); }
    else { reasons.push(`RSI ${rsi.toFixed(0)} neutral`); }

    if (macd > signal && histogram > 0) { upVotes += 2; reasons.push("MACD bullish crossover"); }
    else if (macd < signal && histogram < 0) { downVotes += 2; reasons.push("MACD bearish crossover"); }
    else { reasons.push("MACD flat"); }

    if (momentum > 0.1) { upVotes += 1; reasons.push(`+${momentum.toFixed(2)}% 5-bar momentum`); }
    else if (momentum < -0.1) { downVotes += 1; reasons.push(`${momentum.toFixed(2)}% 5-bar momentum`); }

  } else if (strategy === "mean_reversion") {
    if (rsi > 70) { downVotes += 3; reasons.push(`RSI ${rsi.toFixed(0)} overbought — fade`); }
    else if (rsi < 30) { upVotes += 3; reasons.push(`RSI ${rsi.toFixed(0)} oversold — fade`); }
    else { reasons.push(`RSI ${rsi.toFixed(0)}`); }

    if (momentum > 0.3) { downVotes += 1; reasons.push("Price extended up — mean revert"); }
    else if (momentum < -0.3) { upVotes += 1; reasons.push("Price extended down — mean revert"); }
  } else {
    reasons.push("Market price strategy (no TA)");
  }

  const total = upVotes + downVotes;
  if (total === 0) {
    return { direction: "neutral", confidence: 0, reasoning: reasons.join(" | "), rsi, macd, macdSignal: signal };
  }

  if (upVotes > downVotes) {
    const confidence = Math.min(95, (upVotes / total) * 100);
    return { direction: "up", confidence, reasoning: reasons.join(" | "), rsi, macd, macdSignal: signal };
  } else if (downVotes > upVotes) {
    const confidence = Math.min(95, (downVotes / total) * 100);
    return { direction: "down", confidence, reasoning: reasons.join(" | "), rsi, macd, macdSignal: signal };
  }
  return { direction: "neutral", confidence: 0, reasoning: reasons.join(" | "), rsi, macd, macdSignal: signal };
}
