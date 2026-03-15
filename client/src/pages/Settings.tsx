import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Power, Key, Trash2, Save, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const VERSION_COLORS = [
  "rgba(139,92,246,0.8)","rgba(59,130,246,0.8)","rgba(16,185,129,0.8)",
  "rgba(245,158,11,0.8)","rgba(236,72,153,0.8)","rgba(14,165,233,0.8)",
  "rgba(239,68,68,0.8)","rgba(251,146,60,0.8)",
];
const vColor = (v: number) => VERSION_COLORS[(v - 1) % VERSION_COLORS.length];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{title}</span>
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-border/40 last:border-0 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-foreground">{label}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        <div className="ml-4 flex-shrink-0">{children}</div>
      </div>
    </div>
  );
}

// Combined slider + number input
function SliderInput({
  value, onChange, min, max, step = 1, suffix = "", prefix = "",
  color = "primary"
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
  suffix?: string; prefix?: string; color?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center gap-2">
        {/* Typed number input */}
        <div className="flex items-center gap-1">
          {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
          <input
            type="number"
            min={min} max={max} step={step}
            value={value}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            className="w-20 px-2 py-1.5 rounded-md text-sm font-mono text-right bg-muted border border-border focus:outline-none focus:border-primary text-foreground"
          />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      {/* Slider */}
      <div className="relative h-5 flex items-center">
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        />
        {/* Custom thumb */}
        <div
          className="absolute w-4 h-4 rounded-full bg-primary border-2 border-background shadow-md pointer-events-none transition-all"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{prefix}{min}{suffix}</span>
        <span>{prefix}{max}{suffix}</span>
      </div>
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: { options: { label: string; value: any }[]; value: any; onChange: (v: any) => void }) {
  return (
    <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            value === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}>{o.label}</button>
      ))}
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const { data: creds } = useQuery<any>({ queryKey: ["/api/credentials"] });
  const { data: logData } = useQuery<any>({ queryKey: ["/api/settings/log"] });

  // Local draft state — changes here don't apply until Save
  const [draft, setDraft] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync draft when settings load
  useEffect(() => {
    if (settings && !dirty) setDraft(settings);
  }, [settings]);

  const [apiKeyId, setApiKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [env, setEnv] = useState("production");
  const [credMsg, setCredMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const updateSettings = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/settings", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    },
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
    e.preventDefault(); setSaving(true); setCredMsg("");
    try {
      const res = await fetch("/api/credentials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyId, privateKeyPem: privateKey, environment: env }),
      });
      const json = await res.json();
      if (json.success) {
        setCredMsg(`Connected — balance $${json.balance?.toFixed(2)}`);
        qc.invalidateQueries({ queryKey: ["/api/credentials"] });
        setApiKeyId(""); setPrivateKey("");
      } else setCredMsg("Error: " + (json.error ?? "unknown"));
    } catch (e: any) { setCredMsg("Error: " + e.message); }
    setSaving(false);
  }

  function set(key: string, value: any) {
    setDraft((d: any) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  function handleSave() {
    if (!draft) return;
    const { id, settingsVersion, ...rest } = draft;
    updateSettings.mutate(rest);
  }

  const s = draft ?? settings ?? {};
  const botOn = settings?.enabled ?? false;

  if (!draft) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link href="/">
            <button className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ArrowLeft size={16} />
            </button>
          </Link>
          <span className="text-sm font-semibold">Settings</span>
          <span className="text-xs text-muted-foreground">v{settings?.settingsVersion ?? 1}</span>
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-yellow-400">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || updateSettings.isPending}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all border",
                saved
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : dirty
                  ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                  : "bg-muted border-border text-muted-foreground opacity-50 cursor-not-allowed"
              )}
            >
              {saved ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save</>}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">

        {/* Bot toggle — applies immediately, no save needed */}
        <Section title="Bot">
          <Field label="Status" hint={botOn ? "Actively trading" : "Stopped"}>
            <button
              onClick={() => toggleBot.mutate(!botOn)}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all border",
                botOn
                  ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                  : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
              )}
            >
              <Power size={13} /> {botOn ? "Stop Bot" : "Start Bot"}
            </button>
          </Field>
        </Section>

        {/* Trade sizing */}
        <Section title="Trade Sizing">
          <div className="py-3 border-b border-border/40 space-y-1">
            <div className="text-sm text-foreground">Risk per trade</div>
            <div className="text-xs text-muted-foreground">% of balance staked per entry</div>
            <div className="pt-1">
              <SliderInput value={s.riskPercent ?? 10} onChange={v => set("riskPercent", v)} min={1} max={50} suffix="%" />
            </div>
          </div>
          <div className="py-3 space-y-1">
            <div className="text-sm text-foreground">Target balance</div>
            <div className="text-xs text-muted-foreground">Bot pauses when balance reaches this</div>
            <div className="pt-1">
              <SliderInput value={s.targetBalance ?? 100} onChange={v => set("targetBalance", v)} min={10} max={500} step={10} prefix="$" />
            </div>
          </div>
        </Section>

        {/* Exit thresholds */}
        <Section title="Exit Thresholds">
          <div className="py-3 border-b border-border/40 space-y-1">
            <div className="text-sm text-foreground">Profit target</div>
            <div className="text-xs text-muted-foreground">Auto-sell when bid is this far above entry</div>
            <div className="pt-1">
              <SliderInput value={s.profitTarget ?? 35} onChange={v => set("profitTarget", v)} min={5} max={90} suffix="%" />
            </div>
          </div>
          <div className="py-3 space-y-1">
            <div className="text-sm text-foreground">Stop-loss</div>
            <div className="text-xs text-muted-foreground">Auto-sell when bid drops this far below entry</div>
            <div className="pt-1">
              <SliderInput value={s.stopLoss ?? 5} onChange={v => set("stopLoss", v)} min={1} max={80} suffix="%" />
            </div>
          </div>
        </Section>

        {/* Signal config */}
        <Section title="Signal Config">
          <div className="py-3 border-b border-border/40 space-y-1">
            <div className="text-sm text-foreground">Min confidence</div>
            <div className="text-xs text-muted-foreground">Minimum signal strength to place a trade</div>
            <div className="pt-1">
              <SliderInput value={s.minConfidence ?? 50} onChange={v => set("minConfidence", v)} min={40} max={95} step={5} suffix="%" />
            </div>
          </div>
          <div className="py-3 border-b border-border/40 space-y-1">
            <div className="text-sm text-foreground">Swing threshold</div>
            <div className="text-xs text-muted-foreground">Min BTC % move to trigger a signal</div>
            <div className="pt-1">
              <SliderInput value={s.swingThreshold ?? 0.03} onChange={v => set("swingThreshold", v)} min={0.01} max={0.2} step={0.01} suffix="%" />
            </div>
          </div>
          <Field label="Swing lookback" hint="Ticks to measure swing over">
            <SegmentedControl
              options={[{label:"2",value:2},{label:"3",value:3},{label:"5",value:5},{label:"8",value:8}]}
              value={s.swingLookback ?? 3}
              onChange={(v: number) => set("swingLookback", v)}
            />
          </Field>
          <Field label="Poll speed">
            <SegmentedControl
              options={[{label:"3s",value:3},{label:"5s",value:5},{label:"10s",value:10},{label:"15s",value:15}]}
              value={s.pollInterval ?? 5}
              onChange={(v: number) => set("pollInterval", v)}
            />
          </Field>
        </Section>

        {/* Save button — bottom too for convenience */}
        <button
          onClick={handleSave}
          disabled={!dirty || updateSettings.isPending}
          className={cn(
            "w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2",
            saved
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : dirty
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed border border-border"
          )}
        >
          {saved ? <><Check size={14} /> Settings Saved</> : <><Save size={14} /> Save Settings</>}
        </button>

        {/* Credentials */}
        <Section title="API Credentials">
          {creds?.connected ? (
            <Field label="Kalshi API" hint={`${creds.environment} · ${creds.apiKeyId}`}>
              <button onClick={() => deleteCreds.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all">
                <Trash2 size={11} /> Disconnect
              </button>
            </Field>
          ) : (
            <form onSubmit={saveCreds} className="py-3 space-y-3">
              <SegmentedControl
                options={[{label:"Production",value:"production"},{label:"Demo",value:"demo"}]}
                value={env} onChange={setEnv}
              />
              <input className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-muted border border-border focus:outline-none focus:border-primary text-foreground placeholder:text-muted-foreground"
                placeholder="API Key ID" value={apiKeyId} onChange={e => setApiKeyId(e.target.value)} />
              <textarea className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-muted border border-border focus:outline-none focus:border-primary text-foreground placeholder:text-muted-foreground h-28 resize-none"
                placeholder="-----BEGIN PRIVATE KEY-----" value={privateKey} onChange={e => setPrivateKey(e.target.value)} />
              <button type="submit" disabled={saving || !apiKeyId || !privateKey}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-all">
                {saving ? "Connecting…" : "Connect"}
              </button>
              {credMsg && <p className={cn("text-xs", credMsg.startsWith("Error") ? "text-red-400" : "text-green-400")}>{credMsg}</p>}
            </form>
          )}
        </Section>

        {/* Settings history */}
        {logData?.log?.length > 0 && (
          <Section title="Settings History">
            <div className="py-2 space-y-0">
              {logData.log.slice(0, 8).map((entry: any) => {
                const snap = JSON.parse(entry.snapshot ?? "{}");
                const color = vColor(entry.version);
                return (
                  <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color }}>v{entry.version}</span>
                        <span className="text-xs text-muted-foreground">{new Date(entry.changedAt).toLocaleString()}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Risk {snap.riskPercent}% · Target +{snap.profitTarget}% · Stop -{snap.stopLoss}% · Threshold {snap.swingThreshold}% · Poll {snap.pollInterval}s
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        <div className="text-center text-[10px] text-muted-foreground/30 pb-4">Powered by Perplexity Computer</div>
      </main>
    </div>
  );
}
