import { storage } from "./storage";
import {
  getBtcPrice, getBtc15mMarkets, getBalance, getOpenPositions,
  getSettledPositions, getOrderFills, placeOrder, cancelOrder, KalshiMarket
} from "./kalshi";
import { generateSignal } from "./indicators";
import type { EventEmitter } from "events";

export interface EngineState {
  running: boolean;
  lastRun: Date | null;
  btcPrice: number;
  balance: number;
  openPositions: any[];
  lastSignal: {
    direction: string;
    confidence: number;
    reasoning: string;
    rsi: number;
    macd: number;
    macdSignal: number;
  } | null;
  currentMarket: KalshiMarket | null;
  error: string | null;
  priceHistory: Array<{ time: number; price: number }>;
  activeSwingTrade: SwingTrade | null;
  lastExitReason: string | null;
}

// Tracks a live swing position for P&L monitoring and exit logic
interface SwingTrade {
  tradeId: number;
  orderId: string;
  stopOrderId?: string;   // bracket stop-loss order id on Kalshi
  ticker: string;
  side: "yes" | "no";
  count: number;
  entryPriceInCents: number;
  stopPriceInCents: number;   // pre-calculated stop price
  targetPriceInCents: number; // pre-calculated profit target
  btcPriceAtEntry: number;
  openedAt: number;
}

const state: EngineState = {
  running: false,
  lastRun: null,
  btcPrice: 0,
  balance: 0,
  openPositions: [],
  lastSignal: null,
  currentMarket: null,
  error: null,
  priceHistory: [],
  activeSwingTrade: null,
  lastExitReason: null,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let emitter: EventEmitter | null = null;
let priceHistory: number[] = [];

export function setEmitter(e: EventEmitter) { emitter = e; }

function broadcast(event: string, data: any) {
  if (emitter) emitter.emit("sse", { event, data });
}

export function getState(): EngineState {
  return { ...state };
}

// ── MAIN CYCLE ──────────────────────────────────────────────────────────────
async function runCycle() {
  const settings = await storage.getBotSettings();
  const creds    = await storage.getCredentials();

  // 1. BTC price
  try {
    const price = await getBtcPrice();
    if (price > 0) {
      state.btcPrice = price;
      priceHistory.push(price);
      if (priceHistory.length > 200) priceHistory.shift();
      state.priceHistory.push({ time: Date.now(), price });
      if (state.priceHistory.length > 120) state.priceHistory.shift();
    }
  } catch (e: any) { state.error = "BTC price fetch failed: " + e.message; }

  // 2. Markets
  try {
    const markets = await getBtc15mMarkets(creds?.environment ?? "production");
    if (markets.length > 0) {
      const sorted = [...markets].sort(
        (a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime()
      );
      // Filter out stale/bad markets (0 volume, weird tickers not matching KXBTC15M pattern)
      const valid = sorted.filter(m =>
        m.ticker.startsWith("KXBTC15M") &&
        m.status === "open" &&
        new Date(m.close_time).getTime() > Date.now()
      );
      state.currentMarket = valid[0] ?? sorted[0];
    }
  } catch (e: any) { state.error = "Market fetch failed: " + e.message; }

  // 3. Balance + positions
  if (creds) {
    try {
      state.balance = await getBalance(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      state.openPositions = await getOpenPositions(creds.apiKeyId, creds.privateKeyPem, creds.environment);
      state.error = null;
    } catch (e: any) { state.error = "Auth failed: " + e.message; }
  }

  // 4. Signal
  if (priceHistory.length >= 4) {
    const sig = generateSignal(
      priceHistory,
      settings.strategy,
      settings.swingThreshold,
      settings.swingLookback
    );
    state.lastSignal = sig;

    if (state.currentMarket) {
      await storage.createSignal({
        direction: sig.direction,
        confidence: sig.confidence,
        btcPrice: state.btcPrice,
        marketTicker: state.currentMarket.ticker,
        marketYesPrice: state.currentMarket.yes_bid,
        rsi: sig.rsi,
        macd: sig.macd,
        macdSignal: sig.macdSignal,
        reasoning: sig.reasoning,
        traded: false,
      });
    }
  }

  state.lastRun = new Date();

  // 5. Trading logic
  if (settings.enabled && creds && state.currentMarket) {
    // 5a. Check exit on active swing
    if (state.activeSwingTrade) {
      await checkSwingExit(settings, creds, state.activeSwingTrade, state.currentMarket);
    }

    // 5b. If no active trade, look for entry (re-enters immediately after exit)
    if (!state.activeSwingTrade && state.lastSignal) {
      await trySwingEntry(settings, creds, state.lastSignal, state.currentMarket);
    }
  }

  broadcast("state", buildStatePayload());
}

// ── SWING EXIT ──────────────────────────────────────────────────────────────
async function checkSwingExit(
  settings: any,
  creds: any,
  swing: SwingTrade,
  market: KalshiMarket
) {
  const msToClose = new Date(market.close_time).getTime() - Date.now();
  const marketAlreadyClosed = msToClose <= 0;

  // Old market closed — reconcile P&L from Kalshi
  if (swing.ticker !== market.ticker) {
    console.log(`[Swing] Old trade on ${swing.ticker} — market closed, reconciling P&L...`);
    let resolvedPnl: number | null = null;
    let resolvedStatus = "settled";
    if (creds) {
      try {
        const settled = await getSettledPositions(creds.apiKeyId, creds.privateKeyPem, creds.environment);
        const pos = settled.find((p: any) => p.ticker === swing.ticker);
        if (pos) {
          const realized = pos.realized_pnl ?? pos.pnl ?? null;
          if (realized !== null) {
            resolvedPnl = realized / 100;
            resolvedStatus = resolvedPnl >= 0 ? "won" : "lost";
          } else if (pos.settlement_value !== undefined) {
            resolvedPnl = (pos.settlement_value / 100) - (swing.entryPriceInCents / 100 * swing.count);
            resolvedStatus = resolvedPnl >= 0 ? "won" : "lost";
          }
        }
      } catch (e) { console.log(`[Swing] Settled positions fetch failed:`, e); }
    }
    await storage.updateTrade(swing.tradeId, {
      status: resolvedStatus,
      pnl: resolvedPnl,
      signalReason: `SETTLED: market ${swing.ticker} closed${resolvedPnl !== null ? ` | P&L: $${resolvedPnl.toFixed(2)}` : ""}`,
      resolvedAt: new Date(),
    });
    state.activeSwingTrade = null;
    state.lastExitReason = `Market ${swing.ticker} closed — settled${resolvedPnl !== null ? ` (${resolvedPnl >= 0 ? "+" : ""}$${resolvedPnl.toFixed(2)})` : ""}`;
    broadcast("info", { message: `Trade settled: ${swing.ticker}${resolvedPnl !== null ? ` | P&L: ${resolvedPnl >= 0 ? "+" : ""}$${resolvedPnl.toFixed(2)}` : ""}` });
    return;
  }

  if (marketAlreadyClosed) {
    await storage.updateTrade(swing.tradeId, { status: "settled", signalReason: "SETTLED: market closed", resolvedAt: new Date() });
    state.activeSwingTrade = null;
    state.lastExitReason = "Market closed — settled by Kalshi";
    return;
  }

  const currentBid = swing.side === "yes" ? market.yes_bid : market.no_bid;
  const currentAsk = swing.side === "yes" ? market.yes_ask : market.no_ask;
  const hasBid = currentBid > 0;

  // Close <30s no liquidity — clear
  if (msToClose < 30_000 && !hasBid) {
    let resolvedPnl: number | null = null;
    let resolvedStatus = "settled";
    if (creds) {
      try {
        const settled = await getSettledPositions(creds.apiKeyId, creds.privateKeyPem, creds.environment);
        const pos = settled.find((p: any) => p.ticker === swing.ticker);
        if (pos) {
          const realized = pos.realized_pnl ?? pos.pnl ?? null;
          if (realized !== null) { resolvedPnl = realized / 100; resolvedStatus = resolvedPnl >= 0 ? "won" : "lost"; }
        }
      } catch {}
    }
    await storage.updateTrade(swing.tradeId, {
      status: resolvedStatus, pnl: resolvedPnl,
      signalReason: `SETTLED: no liquidity at close${resolvedPnl !== null ? ` | P&L: $${resolvedPnl.toFixed(2)}` : ""}`,
      resolvedAt: new Date(),
    });
    state.activeSwingTrade = null;
    state.lastExitReason = `Settled at close (no liquidity)${resolvedPnl !== null ? ` | ${resolvedPnl >= 0 ? "+" : ""}$${resolvedPnl.toFixed(2)}` : ""}`;
    return;
  }

  const pnlPct = hasBid ? ((currentBid - swing.entryPriceInCents) / swing.entryPriceInCents) * 100 : 0;

  // Use pre-calculated target/stop prices for precision — no overshoot
  const hitProfit   = hasBid && currentBid >= swing.targetPriceInCents;
  const hitStopLoss = hasBid && currentBid <= swing.stopPriceInCents;
  const nearClose   = msToClose < 60_000 && hasBid;

  if (!hitProfit && !hitStopLoss && !nearClose) return;

  const reason = hitProfit
    ? `Profit target +${settings.profitTarget}% hit (actual: +${pnlPct.toFixed(1)}%)`
    : nearClose
      ? `Market closing in <60s — exiting (P&L: ${pnlPct.toFixed(1)}%)`
      : `Stop-loss -${settings.stopLoss}% hit (actual: ${pnlPct.toFixed(1)}%)`;

  console.log(`[Swing] EXIT — ${reason}`);

  try {
    // Use ask price if available for better fill on exit, else use bid
    const exitPrice = Math.max(1, Math.min(99, currentAsk > 0 ? currentAsk : currentBid));
    await placeOrder(
      creds.apiKeyId, creds.privateKeyPem,
      swing.ticker, swing.side, "sell", swing.count, exitPrice, creds.environment
    );

    const pnlDollars = ((currentBid - swing.entryPriceInCents) / 100) * swing.count;
    await storage.updateTrade(swing.tradeId, {
      status: pnlDollars >= 0 ? "won" : "lost",
      pnl: pnlDollars,
      resolvedAt: new Date(),
      signalReason: `EXIT: ${reason}`,
    });

    state.lastExitReason = reason;
    state.activeSwingTrade = null;

    broadcast("trade", {
      message: `Swing exit: ${swing.side.toUpperCase()} sold @ ${exitPrice}¢ | ${reason}`,
      pnl: pnlDollars,
    });
  } catch (e: any) {
    state.error = "Sell order failed: " + e.message;
    broadcast("error", { message: e.message });
  }
}

// ── SWING ENTRY ─────────────────────────────────────────────────────────────
async function trySwingEntry(
  settings: any,
  creds: any,
  signal: { direction: string; confidence: number; reasoning: string },
  market: KalshiMarket
) {
  if (signal.direction === "neutral") return;
  if (signal.confidence < settings.minConfidence) return;

  const msToClose = new Date(market.close_time).getTime() - Date.now();
  if (msToClose < 90_000) {
    console.log(`[Swing] Skipping entry — market closes in ${Math.round(msToClose / 1000)}s`);
    return;
  }

  // Balance cap guard
  if (state.balance >= settings.targetBalance) {
    console.log(`[Bot] Balance ${state.balance} ≥ target ${settings.targetBalance}, pausing`);
    await storage.updateBotSettings({ enabled: false });
    broadcast("info", { message: `🎯 Target balance $${settings.targetBalance} reached! Bot paused.` });
    return;
  }

  const tradeAmount = state.balance * (settings.riskPercent / 100);
  if (tradeAmount < 0.01) return;

  let side: "yes" | "no";
  let priceInCents: number;

  if (signal.direction === "up") {
    side = "yes";
    priceInCents = Math.max(1, Math.min(99, market.yes_ask > 0 ? market.yes_ask : (market.yes_bid > 0 ? market.yes_bid + 1 : 50)));
  } else {
    side = "no";
    priceInCents = Math.max(1, Math.min(99, market.no_ask > 0 ? market.no_ask : (market.no_bid > 0 ? market.no_bid + 1 : 50)));
  }

  // Pre-calculate stop and target prices at entry time — avoids overshoot
  const stopPriceInCents   = Math.max(1, Math.round(priceInCents * (1 - settings.stopLoss / 100)));
  const targetPriceInCents = Math.min(99, Math.round(priceInCents * (1 + settings.profitTarget / 100)));

  const pricePerContract = priceInCents / 100;
  const count = Math.max(1, Math.floor(tradeAmount / pricePerContract));
  const actualCost = count * pricePerContract;

  try {
    const order = await placeOrder(
      creds.apiKeyId, creds.privateKeyPem,
      market.ticker, side, "buy", count, priceInCents, creds.environment
    );

    const trade = await storage.createTrade({
      orderId: order.order_id,
      ticker: market.ticker,
      side,
      action: "buy",
      count,
      pricePerContract: priceInCents,
      totalCost: actualCost,
      status: "filled",
      signalReason: `[SWING ${signal.direction.toUpperCase()} ${signal.confidence.toFixed(0)}%] ${signal.reasoning}`,
      btcPriceAtTrade: state.btcPrice,
      marketTitle: market.title,
      settingsVersion: settings.settingsVersion,
    });

    state.activeSwingTrade = {
      tradeId: trade.id,
      orderId: order.order_id,
      ticker: market.ticker,
      side,
      count,
      entryPriceInCents: priceInCents,
      stopPriceInCents,
      targetPriceInCents,
      btcPriceAtEntry: state.btcPrice,
      openedAt: Date.now(),
    };

    broadcast("trade", {
      message: `Swing entry: ${side.toUpperCase()} ${count}x @ ${priceInCents}¢ | target ${targetPriceInCents}¢ (+${settings.profitTarget}%) | stop ${stopPriceInCents}¢ (-${settings.stopLoss}%)`,
      trade,
    });
    console.log(`[Swing] Entered ${side} ${count}x ${market.ticker} @ ${priceInCents}¢ | stop ${stopPriceInCents}¢ | target ${targetPriceInCents}¢`);
  } catch (e: any) {
    state.error = "Order failed: " + e.message;
    broadcast("error", { message: e.message });
  }
}

function buildStatePayload() {
  return {
    btcPrice: state.btcPrice,
    balance: state.balance,
    openPositions: state.openPositions,
    lastSignal: state.lastSignal,
    currentMarket: state.currentMarket,
    error: state.error,
    lastRun: state.lastRun,
    priceHistory: state.priceHistory,
    activeSwingTrade: state.activeSwingTrade,
    lastExitReason: state.lastExitReason,
  };
}

export async function startEngine() {
  if (intervalHandle) return;
  state.running = true;
  state.activeSwingTrade = null;
  await runCycle();
  const settings = await storage.getBotSettings();
  const pollMs = (settings.pollInterval ?? 5) * 1000;
  intervalHandle = setInterval(runCycle, pollMs);
  console.log(`[Engine] Started — polling every ${settings.pollInterval ?? 5}s`);
}

export function stopEngine() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  state.running = false;
  state.activeSwingTrade = null;
  console.log("[Engine] Stopped");
}

export async function restartEngine() {
  stopEngine();
  await startEngine();
}
