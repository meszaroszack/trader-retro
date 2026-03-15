import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Settings, TrendingUp, TrendingDown, Minus, Zap, Target, Clock, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const VERSION_COLORS = [
  "rgba(139,92,246,0.7)","rgba(59,130,246,0.7)","rgba(16,185,129,0.7)",
  "rgba(245,158,11,0.7)","rgba(236,72,153,0.7)","rgba(14,165,233,0.7)",
  "rgba(239,68,68,0.7)","rgba(251,146,60,0.7)",
];
const vColor = (v: number) => VERSION_COLORS[(v - 1) % VERSION_COLORS.length];
const vBorder = (v: number) => `border-l-2 pl-3` + ` v-color-${((v - 1) % 8) + 1}`;

function formatPrice(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n.toFixed(2);
}
function formatTime(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "won" ? "badge-won" :
    status === "lost" ? "badge-lost" :
    status === "filled" ? "badge-filled" :
    "badge-settled";
  return <span className={cls}>{status.toUpperCase()}</span>;
}

function StatCard({ label, value, sub, color, icon }: any) {
  return (
    <div className="glass slide-up p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40 uppercase tracking-widest">{label}</span>
        {icon && <span className="text-white/25">{icon}</span>}
      </div>
      <div className={cn("text-2xl font-semibold tracking-tight", color ?? "text-white/90")}>{value}</div>
      {sub && <div className="text-xs text-white/35">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [sseState, setSseState] = useState<any>({});
  const prevBtc = useRef<number>(0);
  const [flash, setFlash] = useState("");

  const { data: tradesData, refetch: refetchTrades } = useQuery<any>({
    queryKey: ["/api/trades"],
    refetchInterval: 8000,
  });
  const { data: creds } = useQuery<any>({ queryKey: ["/api/credentials"] });
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("state", (e) => {
      const d = JSON.parse(e.data);
      setSseState(d);
      if (d.btcPrice && prevBtc.current) {
        setFlash(d.btcPrice > prevBtc.current ? "flash-green" : d.btcPrice < prevBtc.current ? "flash-red" : "");
        setTimeout(() => setFlash(""), 900);
      }
      prevBtc.current = d.btcPrice ?? prevBtc.current;
    });
    es.addEventListener("trade", () => refetchTrades());
    return () => es.close();
  }, []);

  const trades = tradesData?.trades ?? [];
  const totalPnL = trades.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
  const totalSpent = trades.reduce((s: number, t: any) => s + (t.totalCost ?? 0), 0);
  const wins = trades.filter((t: any) => t.status === "won").length;
  const losses = trades.filter((t: any) => t.status === "lost").length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

  const market = sseState.currentMarket;
  const swing = sseState.activeSwingTrade;
  const sig = sseState.lastSignal;
  const botOn = settings?.enabled ?? false;

  const chartData = (sseState.priceHistory ?? []).map((p: any) => ({
    t: new Date(p.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    price: p.price,
  }));

  // Active swing live P&L
  let swingBid = 0, swingPnlPct = 0, swingPnlDollar: number | null = null;
  if (swing && market) {
    swingBid = swing.side === "yes" ? (market.yes_bid ?? 0) : (market.no_bid ?? 0);
    if (swingBid > 0) {
      swingPnlPct = ((swingBid - swing.entryPriceInCents) / swing.entryPriceInCents) * 100;
      swingPnlDollar = ((swingBid - swing.entryPriceInCents) / 100) * swing.count;
    }
  }

  return (
    <div className="min-h-screen">
      {/* NAV */}
      <nav className="glass-nav sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("w-2 h-2 rounded-full", botOn ? "bg-green-400 pulse-dot" : "bg-white/20")} />
            <span className="text-sm font-semibold tracking-tight text-white/80">Kalshi BTC Trader</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/history">
              <button className="glass-btn px-3 py-1.5 text-xs text-white/60 hover:text-white/90">History</button>
            </Link>
            <Link href="/settings">
              <button className="glass-btn px-3 py-1.5 text-xs text-white/60 hover:text-white/90 flex items-center gap-1.5">
                <Settings size={12} /> Settings
              </button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-5 py-6 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="BTC Price"
            value={<span className={cn("text-orange-400", flash)}>${formatPrice(sseState.btcPrice ?? 0)}</span>}
            icon={<span className="text-orange-400 text-base">₿</span>}
          />
          <StatCard
            label="Balance"
            value={creds?.connected ? `$${formatPrice(sseState.balance ?? 0)}` : "—"}
            color="text-green-400"
            sub={settings ? `Target $${settings.targetBalance}` : undefined}
            icon={<TrendingUp size={14} />}
          />
          <StatCard
            label="Total P&L"
            value={`${totalPnL >= 0 ? "+" : ""}$${Math.abs(totalPnL).toFixed(2)}`}
            color={totalPnL >= 0 ? "text-green-400" : "text-red-400"}
            sub={`${wins}W / ${losses}L · ${winRate.toFixed(0)}% win`}
            icon={totalPnL >= 0 ? <ChevronUp size={14} className="text-green-400" /> : <ChevronDown size={14} className="text-red-400" />}
          />
          <StatCard
            label="Total Spent"
            value={`$${totalSpent.toFixed(2)}`}
            color="text-white/70"
            sub={`${trades.length} trades`}
            icon={<Clock size={12} />}
          />
        </div>

        {/* Active swing + signal row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Active swing trade */}
          {swing ? (
            <div className={cn("glass slide-up p-4", swingPnlPct >= 0 ? "glass-active" : "glass-danger")}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target size={14} className="text-green-400 animate-pulse" />
                  <span className="text-xs font-semibold text-white/70 uppercase tracking-widest">Active Trade</span>
                </div>
                <span className="badge-filled">LIVE</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-white/35 mb-0.5 uppercase tracking-wide">Side</div>
                  <div className={cn("text-base font-bold", swing.side === "yes" ? "text-green-400" : "text-red-400")}>
                    {swing.side.toUpperCase()} <span className="text-white/40 text-sm font-normal">×{swing.count}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-white/35 mb-0.5 uppercase tracking-wide">Entry</div>
                  <div className="text-base font-mono">{swing.entryPriceInCents}¢</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/35 mb-0.5 uppercase tracking-wide">Current Bid</div>
                  <div className={cn("text-base font-mono", swingBid > 0 ? (swingPnlPct >= 0 ? "text-green-400" : "text-red-400") : "text-white/30")}>
                    {swingBid > 0 ? `${swingBid}¢` : "waiting…"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-white/35 mb-0.5 uppercase tracking-wide">Unrealized P&L</div>
                  <div className={cn("text-base font-bold", swingBid > 0 ? (swingPnlPct >= 0 ? "text-green-400" : "text-red-400") : "text-white/30")}>
                    {swingBid > 0 ? (
                      <>{swingPnlPct >= 0 ? "+" : ""}{swingPnlPct.toFixed(1)}% <span className="text-xs font-normal text-white/50">({swingPnlPct >= 0 ? "+$" : "-$"}{Math.abs(swingPnlDollar ?? 0).toFixed(2)})</span></>
                    ) : "no bid"}
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3">
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", swingPnlPct >= 0 ? "bg-green-400" : "bg-red-400")}
                    style={{ width: `${Math.min(100, settings ? (Math.abs(swingPnlPct) / Math.max(settings.profitTarget ?? 25, settings.stopLoss ?? 20)) * 100 : Math.abs(swingPnlPct))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/25 mt-1">
                  <span>Stop -{settings?.stopLoss ?? 20}%</span>
                  <span>Target +{settings?.profitTarget ?? 25}%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass p-4 flex flex-col justify-center items-center gap-2 text-white/25 min-h-[140px]">
              {sseState.lastExitReason ? (
                <>
                  <Zap size={16} className="text-white/20" />
                  <span className="text-xs text-center text-white/40">Last exit:</span>
                  <span className="text-xs text-center text-white/55 max-w-[220px]">{sseState.lastExitReason}</span>
                  <span className="text-[10px] text-white/25 mt-1">Looking for next entry…</span>
                </>
              ) : (
                <>
                  <Target size={16} />
                  <span className="text-xs">No active trade</span>
                </>
              )}
            </div>
          )}

          {/* Signal card */}
          <div className="glass p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Signal</span>
              {market && (
                <span className="text-[10px] text-white/30 font-mono truncate max-w-[140px]">{market.ticker}</span>
              )}
            </div>
            {sig ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={cn("text-2xl font-bold tracking-tight",
                    sig.direction === "up" ? "text-green-400" :
                    sig.direction === "down" ? "text-red-400" : "text-yellow-400"
                  )}>
                    {sig.direction === "up" ? <TrendingUp size={22} /> : sig.direction === "down" ? <TrendingDown size={22} /> : <Minus size={22} />}
                  </div>
                  <div>
                    <div className={cn("text-sm font-semibold",
                      sig.direction === "up" ? "text-green-400" :
                      sig.direction === "down" ? "text-red-400" : "text-yellow-400"
                    )}>
                      {sig.direction.toUpperCase()}
                    </div>
                    <div className="text-xs text-white/40">{sig.confidence.toFixed(0)}% confidence</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-xs text-white/35">RSI {sig.rsi?.toFixed(0)}</div>
                    <div className="text-xs text-white/35">MACD {sig.macd?.toFixed(2)}</div>
                  </div>
                </div>
                <div className="text-[11px] text-white/40 leading-relaxed">{sig.reasoning}</div>
                {market && (
                  <div className="flex gap-4 pt-1 border-t border-white/5 text-[10px] text-white/30">
                    <span>YES bid <span className="text-white/60 font-mono">{market.yes_bid ?? 0}¢</span></span>
                    <span>NO bid <span className="text-white/60 font-mono">{market.no_bid ?? 0}¢</span></span>
                    <span className="ml-auto">Closes {new Date(market.close_time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-white/25">Warming up…</div>
            )}
          </div>
        </div>

        {/* Price chart */}
        <div className="glass p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">BTC Live Price</span>
            <span className="text-[10px] text-white/25">Updated {formatTime(sseState.lastRun)}</span>
          </div>
          {chartData.length < 3 ? (
            <div className="h-36 flex items-center justify-center text-white/20 text-sm">Collecting price data…</div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(251,146,60)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="rgb(251,146,60)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={["auto","auto"]} tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "rgba(10,12,20,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "0.75rem", fontSize: 11 }}
                  labelStyle={{ color: "rgba(255,255,255,0.4)" }}
                  itemStyle={{ color: "rgb(251,146,60)" }}
                  formatter={(v: any) => [`$${v.toLocaleString()}`, "BTC"]}
                />
                <Area type="monotone" dataKey="price" stroke="rgb(251,146,60)" strokeWidth={1.5} fill="url(#btcGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Error banner */}
        {sseState.error && (
          <div className="glass glass-danger px-4 py-2.5 flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle size={13} /> {sseState.error}
          </div>
        )}

        {/* Recent trades */}
        <div className="glass p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Recent Trades</span>
            <Link href="/history">
              <button className="text-[10px] text-white/30 hover:text-white/60 transition-colors">View all →</button>
            </Link>
          </div>
          {trades.length === 0 ? (
            <div className="text-sm text-white/20 text-center py-6">No trades yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/25 text-[10px] uppercase tracking-widest">
                    <th className="text-left pb-2 pr-4 font-medium">Market</th>
                    <th className="text-left pb-2 pr-4 font-medium">Side</th>
                    <th className="text-right pb-2 pr-4 font-medium">Cost</th>
                    <th className="text-left pb-2 pr-4 font-medium">Status</th>
                    <th className="text-right pb-2 pr-4 font-medium">P&L</th>
                    <th className="text-left pb-2 font-medium hidden md:table-cell">Signal</th>
                    <th className="text-right pb-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 8).map((t: any) => (
                    <tr key={t.id} className={cn("glass-table-row", vBorder(t.settingsVersion ?? 1))}>
                      <td className="py-2 pr-4 font-mono text-white/50 text-[11px] truncate max-w-[120px]">{t.ticker}</td>
                      <td className="py-2 pr-4">
                        <span className={cn("font-bold text-[11px]", t.side === "yes" ? "text-green-400" : "text-red-400")}>{t.side.toUpperCase()}</span>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-white/60">${t.totalCost?.toFixed(2) ?? "0.00"}</td>
                      <td className="py-2 pr-4"><StatusBadge status={t.status} /></td>
                      <td className={cn("py-2 pr-4 text-right font-mono font-semibold",
                        t.pnl == null ? "text-white/25" : t.pnl >= 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : <span className="text-[10px] font-normal">pending</span>}
                      </td>
                      <td className="py-2 pr-4 text-white/30 hidden md:table-cell">
                        <span className="truncate block max-w-[160px] text-[10px]">
                          {t.signalReason?.replace(/^\[.*?\]\s*/, "").split(" | ")[0].slice(0, 38) ?? "—"}
                        </span>
                      </td>
                      <td className="py-2 text-right text-white/30 text-[10px]">{formatTime(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-center text-[10px] text-white/15 pb-4">
          Powered by Perplexity Computer
        </div>
      </main>
    </div>
  );
}
