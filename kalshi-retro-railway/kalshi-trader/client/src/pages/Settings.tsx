import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Power, Key, Trash2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const { data: creds } = useQuery<any>({ queryKey: ["/api/credentials"] });
  const { data: logData } = useQuery<any>({ queryKey: ["/api/settings/log"] });

  const [apiKeyId, setApiKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [env, setEnv] = useState("production");
  const [credMsg, setCredMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const updateSettings = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/settings", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/settings"] }),
  });

  const toggleBot = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("POST", "/api/bot/toggle", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/settings"] }),
  });

  const deleteCreds = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/credentials"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/credentials"] }); setCredMsg("Credentials cleared."); },
  });

  async function saveCreds(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setCredMsg("");
    try {
      const res = await apiRequest("POST", "/api/credentials", { apiKeyId, privateKeyPem: privateKey, environment: env });
      const json = await res.json();
      if (json.success) {
        setCredMsg(`Connected — balance $${json.balance?.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["/api/credentials"] });
        setApiKeyId(""); setPrivateKey("");
      } else {
        setCredMsg("Error: " + (json.error ?? "unknown"));
      }
    } catch (e: any) { setCredMsg("Error: " + e.message); }
    setSaving(false);
  }

  const s = settings ?? {};
  const botOn = s.enabled ?? false;

  function patch(key: string, value: any) {
    updateSettings.mutate({ [key]: value });
  }

  const VERSION_COLORS = [
    "rgba(139,92,246,0.8)","rgba(59,130,246,0.8)","rgba(16,185,129,0.8)",
    "rgba(245,158,11,0.8)","rgba(236,72,153,0.8)","rgba(14,165,233,0.8)",
    "rgba(239,68,68,0.8)","rgba(251,146,60,0.8)",
  ];
  const vColor = (v: number) => VERSION_COLORS[(v - 1) % VERSION_COLORS.length];

  return (
    <div className="min-h-screen">
      <nav className="glass-nav sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-5 h-14 flex items-center gap-3">
          <Link href="/">
            <button className="glass-btn p-2 text-white/50 hover:text-white/90">
              <ArrowLeft size={15} />
            </button>
          </Link>
          <span className="text-sm font-semibold text-white/70">Settings</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-white/30">v{s.settingsVersion ?? 1}</span>
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-4">

        {/* Bot toggle */}
        <div className={cn("glass p-5 flex items-center justify-between", botOn ? "glass-active" : "")}>
          <div>
            <div className="text-sm font-semibold text-white/85">Bot Status</div>
            <div className="text-xs text-white/35 mt-0.5">{botOn ? "Running — actively trading" : "Stopped"}</div>
          </div>
          <button
            onClick={() => toggleBot.mutate(!botOn)}
            className={cn("flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all",
              botOn ? "glass-btn glass-btn-red" : "glass-btn glass-btn-green"
            )}
          >
            <Power size={14} /> {botOn ? "Stop" : "Start"}
          </button>
        </div>

        {/* Trade sizing */}
        <div className="glass p-5 space-y-4">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Trade Sizing</div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Risk per trade</span>
              <span className="text-sm font-mono text-green-400">{s.riskPercent ?? 25}%</span>
            </div>
            <input type="range" min="5" max="50" step="5" value={s.riskPercent ?? 25}
              onChange={(e) => patch("riskPercent", parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-white/25 mt-1"><span>5%</span><span>50%</span></div>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Target balance (pause at)</span>
              <span className="text-sm font-mono text-white/70">${s.targetBalance ?? 100}</span>
            </div>
            <input type="range" min="10" max="500" step="10" value={s.targetBalance ?? 100}
              onChange={(e) => patch("targetBalance", parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        {/* Exit thresholds */}
        <div className="glass p-5 space-y-4">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Exit Thresholds</div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Profit target</span>
              <span className="text-sm font-mono text-green-400">+{s.profitTarget ?? 25}%</span>
            </div>
            <input type="range" min="5" max="90" step="5" value={s.profitTarget ?? 25}
              onChange={(e) => patch("profitTarget", parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Stop-loss</span>
              <span className="text-sm font-mono text-red-400">-{s.stopLoss ?? 20}%</span>
            </div>
            <input type="range" min="5" max="80" step="5" value={s.stopLoss ?? 20}
              onChange={(e) => patch("stopLoss", parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        {/* Signal config */}
        <div className="glass p-5 space-y-4">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Signal Config</div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Min confidence to trade</span>
              <span className="text-sm font-mono text-white/70">{s.minConfidence ?? 60}%</span>
            </div>
            <input type="range" min="40" max="90" step="5" value={s.minConfidence ?? 60}
              onChange={(e) => patch("minConfidence", parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Swing threshold</span>
              <span className="text-sm font-mono text-white/70">{s.swingThreshold ?? 0.05}%</span>
            </div>
            <input type="range" min="0.01" max="0.2" step="0.01" value={s.swingThreshold ?? 0.05}
              onChange={(e) => patch("swingThreshold", parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-white/25 mt-1"><span>0.01% (sensitive)</span><span>0.2% (strong moves only)</span></div>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-white/70">Swing lookback</span>
              <span className="text-sm font-mono text-white/70">{s.swingLookback ?? 3} ticks</span>
            </div>
            <div className="flex gap-2">
              {[2, 3, 5, 8].map(n => (
                <button key={n}
                  onClick={() => patch("swingLookback", n)}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                    s.swingLookback === n ? "glass-btn-green glass-btn" : "glass-btn text-white/50"
                  )}
                >{n}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Poll speed */}
        <div className="glass p-5 space-y-3">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Poll Speed</div>
          <div className="flex gap-2">
            {[3, 5, 10, 15].map(n => (
              <button key={n}
                onClick={() => patch("pollInterval", n)}
                className={cn("flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all",
                  s.pollInterval === n ? "glass-btn-green glass-btn" : "glass-btn text-white/50"
                )}
              >{n}s</button>
            ))}
          </div>
          <p className="text-[10px] text-white/25">Faster = more responsive exits. Railway may rate-limit below 3s.</p>
        </div>

        {/* API Credentials */}
        <div className="glass p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">API Credentials</div>
            {creds?.connected && (
              <button onClick={() => deleteCreds.mutate()} className="glass-btn glass-btn-red px-3 py-1.5 flex items-center gap-1.5 text-xs">
                <Trash2 size={11} /> Disconnect
              </button>
            )}
          </div>

          {creds?.connected ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-green-400/5 border border-green-400/15">
              <Key size={14} className="text-green-400" />
              <div>
                <div className="text-xs font-semibold text-green-400">Connected</div>
                <div className="text-[10px] text-white/35">{creds.environment} · key {creds.apiKeyId}</div>
              </div>
            </div>
          ) : (
            <form onSubmit={saveCreds} className="space-y-3">
              <div className="flex gap-2">
                {["production","demo"].map(e => (
                  <button key={e} type="button"
                    onClick={() => setEnv(e)}
                    className={cn("flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                      env === e ? "glass-btn-green glass-btn" : "glass-btn text-white/50"
                    )}
                  >{e}</button>
                ))}
              </div>
              <input
                className="w-full px-4 py-2.5 rounded-xl text-xs font-mono bg-white/4 border border-white/8 text-white/80 placeholder:text-white/25 focus:outline-none focus:border-green-400/40"
                placeholder="API Key ID"
                value={apiKeyId}
                onChange={e => setApiKeyId(e.target.value)}
              />
              <textarea
                className="w-full px-4 py-2.5 rounded-xl text-xs font-mono bg-white/4 border border-white/8 text-white/80 placeholder:text-white/25 focus:outline-none focus:border-green-400/40 h-28 resize-none"
                placeholder="-----BEGIN PRIVATE KEY-----"
                value={privateKey}
                onChange={e => setPrivateKey(e.target.value)}
              />
              <button type="submit" disabled={saving || !apiKeyId || !privateKey}
                className="w-full py-2.5 rounded-xl glass-btn glass-btn-green text-sm font-semibold disabled:opacity-40">
                {saving ? "Connecting…" : "Connect"}
              </button>
              {credMsg && <p className={cn("text-xs", credMsg.startsWith("Error") ? "text-red-400" : "text-green-400")}>{credMsg}</p>}
            </form>
          )}
        </div>

        {/* Settings version log */}
        {logData?.log?.length > 0 && (
          <div className="glass p-5 space-y-3">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Settings History</div>
            <div className="space-y-2">
              {logData.log.slice(0, 6).map((entry: any) => {
                const snap = JSON.parse(entry.snapshot ?? "{}");
                const color = vColor(entry.version);
                return (
                  <div key={entry.id} className="p-3 rounded-xl bg-white/2 border border-white/5 text-[11px]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="font-semibold text-white/70">v{entry.version}</span>
                      <span className="text-white/25 ml-auto">{new Date(entry.changedAt).toLocaleString()}</span>
                    </div>
                    <div className="flex gap-4 text-white/35 flex-wrap">
                      <span>Risk {snap.riskPercent}%</span>
                      <span>Target +{snap.profitTarget}%</span>
                      <span>Stop -{snap.stopLoss}%</span>
                      <span>Threshold {snap.swingThreshold}%</span>
                      <span>Poll {snap.pollInterval}s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-center text-[10px] text-white/15 pb-4">Powered by Perplexity Computer</div>
      </main>
    </div>
  );
}
