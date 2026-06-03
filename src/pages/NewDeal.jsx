import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useSettings } from "../contexts/SettingsContext";
import { fetchUsers, insertDeal } from "../lib/db";

const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Director/VP override % defaults are driven by the office: Phoenix → 5%,
// Tucson → 3.75% (any other/unknown office falls back to 5%). Manager always
// defaults to 3% regardless of office. Mirrors src/components/DealModal.jsx.
const dirVpDefault = (office) => (office === "Tucson" ? "3.75" : "5");

const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' };
const inputCls = 'w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors';

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
    {children}
  </div>
);

const Inp = (props) => <input {...props} style={inputStyle} className={inputCls} />;
const Sel = ({ children, ...props }) => <select {...props} style={inputStyle} className={inputCls}>{children}</select>;

function Card({ title, children }) {
  return (
    <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4">{title}</p>
      {children}
    </div>
  );
}

function ModeToggle({ mode, setMode }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
      {['pct', 'amt'].map(m => (
        <button key={m} type="button" onClick={() => setMode(m)}
          className={`px-3 py-1.5 text-[12px] font-bold transition-colors ${mode === m ? 'bg-teal text-dark' : 'text-white/40 hover:text-white'}`}>
          {m === 'pct' ? '%' : '$'}
        </button>
      ))}
    </div>
  );
}

export default function NewDeal() {
  const { profile } = useAuth();
  const { statusLabels, offices, paymentMethods } = useSettings();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [dealName, setDealName] = useState("");
  const [saleDate, setSaleDate] = useState(todayISO());
  const [status, setStatus] = useState("Deal Review");
  const [office, setOffice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [baseline, setBaseline] = useState("");
  const [jobPrice, setJobPrice] = useState("");
  const [repCommission, setRepCommission] = useState("");

  const [selfGen, setSelfGen] = useState(false);
  const [repId, setRepId] = useState("");
  const [setterId, setSetterId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [setterSplit, setSetterSplit] = useState(50);

  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductionNote, setDeductionNote] = useState("");

  const [managerId, setManagerId] = useState("");
  const [mgr, setMgr] = useState({ mode: "pct", value: "3" });
  const [dir, setDir] = useState({ mode: "pct", value: "5" });
  const [vp, setVp] = useState({ mode: "pct", value: "5" });

  // Changing the office re-applies the office-driven default to the director/VP
  // override (only while they're in % mode; manager stays at its 3% default).
  function handleOfficeChange(o) {
    setOffice(o);
    const d = dirVpDefault(o);
    setDir(prev => prev.mode === "pct" ? { ...prev, value: d } : prev);
    setVp(prev => prev.mode === "pct" ? { ...prev, value: d } : prev);
  }

  useEffect(() => {
    fetchUsers().then(({ data }) => {
      setProfiles((data || []).filter(u => u.active !== false));
      setLoading(false);
    });
  }, []);

  const director  = useMemo(() => profiles.find(p => p.role === "director"), [profiles]);
  const vpProfile = useMemo(() => profiles.find(p => p.role === "vp"), [profiles]);
  const managers  = useMemo(() => profiles.filter(p => p.role === "manager"), [profiles]);
  const sellers   = useMemo(() => profiles.filter(p => ["rep","manager"].includes(p.role)), [profiles]);

  const base = Number(baseline) || 0;
  const calc = (o) => o.mode === "pct" ? (base * (Number(o.value) || 0)) / 100 : Number(o.value) || 0;
  const mgrAmt = managerId ? calc(mgr) : 0;
  const dirAmt = calc(dir);
  const vpAmt  = calc(vp);
  const repComm  = Number(repCommission) || 0;
  const deduction = Math.max(Number(deductionAmount) || 0, 0);
  const rawSetterAmt = selfGen ? repComm : (repComm * (Number(setterSplit) || 0)) / 100;
  const rawCloserAmt = selfGen ? 0 : repComm - rawSetterAmt;
  const setterAmt = selfGen ? Math.max(rawSetterAmt - deduction, 0) : rawSetterAmt;
  const closerAmt = selfGen ? 0 : Math.max(rawCloserAmt - deduction, 0);
  const totalComm = repComm - deduction + mgrAmt + dirAmt + vpAmt;

  function reset() {
    setDealName(""); setBaseline(""); setJobPrice(""); setRepCommission("");
    setOffice(""); setPaymentMethod("");
    setRepId(""); setSetterId(""); setCloserId(""); setManagerId("");
    setDeductionAmount(""); setDeductionNote("");
    setMgr({ mode: "pct", value: "3" });
    setDir({ mode: "pct", value: "5" });
    setVp({ mode: "pct", value: "5" });
  }

  async function save() {
    setMsg(null);
    if (!dealName.trim())   return setMsg({ type: "err", text: "Deal name is required." });
    if (!base)              return setMsg({ type: "err", text: "Baseline price is required." });
    if (!Number(jobPrice))  return setMsg({ type: "err", text: "Total deal value is required." });
    const primarySetter = selfGen ? repId : setterId;
    if (!primarySetter)  return setMsg({ type: "err", text: selfGen ? "Select the rep." : "Select a setter." });
    if (!selfGen && !closerId) return setMsg({ type: "err", text: "Select a closer, or toggle Self-generated." });
    if (deduction > 0 && !deductionNote.trim()) return setMsg({ type: "err", text: "Add a note explaining the deduction." });

    setSaving(true);
    const { error } = await insertDeal({
      deal_name: dealName.trim(), status, sale_date: saleDate,
      office: office || null, payment_method: paymentMethod || null,
      baseline_revenue: base, job_price: Number(jobPrice),
      setter_id: primarySetter, closer_id: selfGen ? null : closerId,
      setter_split_pct: selfGen ? 1 : (Number(setterSplit) || 0) / 100,
      setter_amount: setterAmt, closer_amount: selfGen ? null : closerAmt,
      manager_id: managerId || null,
      manager_amount: managerId ? mgrAmt : null,
      manager_override_pct: managerId && mgr.mode === "pct" ? (Number(mgr.value) || 0) / 100 : 0,
      director_id: director?.id || null, director_amount: dirAmt || null,
      director_override_pct: dir.mode === "pct" ? (Number(dir.value) || 0) / 100 : 0,
      vp_id: vpProfile?.id || null, vp_amount: vpAmt || null,
      vp_override_pct: vp.mode === "pct" ? (Number(vp.value) || 0) / 100 : 0,
      deduction_amount: deduction || null, deduction_note: deductionNote.trim() || null,
    }, profile?.id);
    setSaving(false);
    if (error) return setMsg({ type: "err", text: error.message });
    setMsg({ type: "ok", text: `Saved "${dealName.trim()}".` });
    reset();
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading team…</div>;

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      <div className="mb-5">
        <h1 className="text-lg md:text-xl font-bold text-white">New Deal</h1>
        <p className="text-[12px] text-white/40 mt-0.5">Enter a deal manually.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
        <div className="space-y-4">

          {/* Deal basics */}
          <Card title="Deal">
            <div className="space-y-3">
              <Field label="Deal name">
                <Inp value={dealName} onChange={e => setDealName(e.target.value)} placeholder="e.g. Smith — 1423 Mesa Dr" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Sale date">
                  <Inp type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
                </Field>
                <Field label="Status">
                  <Sel value={status} onChange={e => setStatus(e.target.value)}>
                    {statusLabels.map(s => <option key={s}>{s}</option>)}
                  </Sel>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Office">
                  <Sel value={office} onChange={e => handleOfficeChange(e.target.value)}>
                    <option value="">Select office…</option>
                    {offices.map(o => <option key={o}>{o}</option>)}
                  </Sel>
                </Field>
                <Field label="Payment method">
                  <Sel value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                    <option value="">Select method…</option>
                    {paymentMethods.map(m => <option key={m}>{m}</option>)}
                  </Sel>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Baseline price">
                  <Inp type="number" value={baseline} onChange={e => setBaseline(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Total deal value">
                  <Inp type="number" value={jobPrice} onChange={e => setJobPrice(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Rep commission">
                  <Inp type="number" value={repCommission} onChange={e => setRepCommission(e.target.value)} placeholder="0.00" />
                </Field>
              </div>
            </div>
          </Card>

          {/* Sale source */}
          <Card title="Sale Source">
            <div className="flex gap-0 mb-4 rounded-lg overflow-hidden border border-white/10 w-fit">
              {[['Setter + Closer', false], ['Self-generated', true]].map(([label, val]) => (
                <button key={label} type="button" onClick={() => setSelfGen(val)}
                  className={`px-4 py-2 text-[12px] font-semibold transition-colors ${selfGen === val ? 'bg-teal text-dark' : 'text-white/40 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>

            {selfGen ? (
              <Field label="Rep (gets 100% minus any deduction)">
                <Sel value={repId} onChange={e => setRepId(e.target.value)}>
                  <option value="">Select rep…</option>
                  {sellers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Sel>
                <p className="text-[11px] font-semibold mt-1.5" style={{ color: '#00b894' }}>Rep gets {money(setterAmt)}</p>
              </Field>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Setter">
                    <Sel value={setterId} onChange={e => setSetterId(e.target.value)}>
                      <option value="">Select…</option>
                      {sellers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Sel>
                  </Field>
                  <Field label="Closer">
                    <Sel value={closerId} onChange={e => setCloserId(e.target.value)}>
                      <option value="">Select…</option>
                      {sellers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Sel>
                  </Field>
                </div>
                <Field label={`Setter split — ${setterSplit}% setter / ${100 - setterSplit}% closer`}>
                  <input type="range" min="0" max="100" value={setterSplit}
                    onChange={e => setSetterSplit(Number(e.target.value))} className="w-full accent-teal" />
                  <p className="text-[11px] font-semibold mt-1" style={{ color: '#00b894' }}>
                    Setter {money(rawSetterAmt)} · Closer {money(rawCloserAmt)}
                  </p>
                </Field>
              </div>
            )}
          </Card>

          {/* Deductions */}
          <Card title="Deductions">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Deduction amount">
                <Inp type="number" value={deductionAmount} onChange={e => setDeductionAmount(e.target.value)} placeholder="0.00" />
                {deduction > 0 && (
                  <p className="text-[11px] font-semibold mt-1" style={{ color: '#f87171' }}>
                    −{money(deduction)} from {selfGen ? 'rep' : 'closer'}
                  </p>
                )}
              </Field>
              <Field label="Reason">
                <textarea value={deductionNote} onChange={e => setDeductionNote(e.target.value)}
                  placeholder="Explain the deduction…" rows={2}
                  className="w-full px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 resize-none"
                  style={inputStyle} />
              </Field>
            </div>
          </Card>

          {/* Overrides */}
          <Card title="Overrides">
            <div className="space-y-4">
              <Field label="Manager">
                <Sel value={managerId} onChange={e => setManagerId(e.target.value)}>
                  <option value="">None</option>
                  {managers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Sel>
              </Field>

              {managerId && (
                <Field label="Manager override">
                  <div className="flex items-center gap-2">
                    <ModeToggle mode={mgr.mode} setMode={m => setMgr({ ...mgr, mode: m })} />
                    <Inp type="number" value={mgr.value} onChange={e => setMgr({ ...mgr, value: e.target.value })}
                      placeholder={mgr.mode === "pct" ? "% of baseline" : "$ amount"} />
                  </div>
                  <p className="text-[11px] font-semibold mt-1 text-teal">{money(mgrAmt)}</p>
                </Field>
              )}

              <Field label={`Director — ${director?.name ?? 'not set'} (default ${dirVpDefault(office)}%)`}>
                <div className="flex items-center gap-2">
                  <ModeToggle mode={dir.mode} setMode={m => setDir({ ...dir, mode: m })} />
                  <Inp type="number" value={dir.value} onChange={e => setDir({ ...dir, value: e.target.value })}
                    placeholder={dir.mode === "pct" ? "% of baseline" : "$ amount"} />
                </div>
                <p className="text-[11px] font-semibold mt-1 text-teal">{money(dirAmt)}</p>
              </Field>

              <Field label={`VP — ${vpProfile?.name ?? 'not set'} (default ${dirVpDefault(office)}%)`}>
                <div className="flex items-center gap-2">
                  <ModeToggle mode={vp.mode} setMode={m => setVp({ ...vp, mode: m })} />
                  <Inp type="number" value={vp.value} onChange={e => setVp({ ...vp, value: e.target.value })}
                    placeholder={vp.mode === "pct" ? "% of baseline" : "$ amount"} />
                </div>
                <p className="text-[11px] font-semibold mt-1 text-teal">{money(vpAmt)}</p>
              </Field>
            </div>
          </Card>
        </div>

        {/* Summary panel */}
        <div className="rounded-xl p-4 lg:sticky lg:top-4" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4">Summary</p>
          <div className="space-y-2">
            {[
              ['Baseline',       money(base)],
              ['Total deal',     money(Number(jobPrice) || 0)],
              ['Setter',         money(rawSetterAmt)],
              ...(!selfGen ? [['Closer', money(rawCloserAmt)]] : []),
              ...(deduction > 0 ? [['Deduction', `−${money(deduction)}`]] : []),
              ...(managerId ? [['Manager', money(mgrAmt)]] : []),
              ['Director',       money(dirAmt)],
              ['VP',             money(vpAmt)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-[13px] pb-2 border-b border-white/5">
                <span className="text-white/50">{label}</span>
                <span className={`font-semibold ${label === 'Deduction' ? 'text-red-400' : 'text-white'}`}>{value}</span>
              </div>
            ))}
            <div className="flex justify-between text-[15px] font-bold pt-1">
              <span className="text-white">Total comm</span>
              <span className="text-teal">{money(totalComm)}</span>
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className="w-full mt-4 py-3 rounded-xl text-[14px] font-bold bg-teal text-dark disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save deal'}
          </button>

          {msg && (
            <div className={`mt-3 p-3 rounded-lg text-[12px] font-semibold ${msg.type === 'ok' ? 'text-teal bg-teal/10' : 'text-red-400 bg-red-500/10'}`}>
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
