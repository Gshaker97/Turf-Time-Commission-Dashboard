import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUSES = ["Deal Review", "Pending Install", "Pay Finalized", "Paid", "Sales Issue"];

export default function NewDeal() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [dealName, setDealName] = useState("");
  const [saleDate, setSaleDate] = useState(todayISO());
  const [status, setStatus] = useState("Deal Review");
  const [baseline, setBaseline] = useState("");
  const [jobPrice, setJobPrice] = useState("");
  const [repCommission, setRepCommission] = useState("");

  const [selfGen, setSelfGen] = useState(false);
  const [repId, setRepId] = useState("");
  const [setterId, setSetterId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [setterSplit, setSetterSplit] = useState(50);

  const [managerId, setManagerId] = useState("");
  const [mgr, setMgr] = useState({ mode: "pct", value: "" });
  const [dir, setDir] = useState({ mode: "pct", value: "5" }); // default 5% off baseline
  const [vp, setVp] = useState({ mode: "pct", value: "5" });   // default 5% off baseline

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,name,role,active")
        .eq("active", true)
        .order("name");
      if (error) setMsg({ type: "err", text: error.message });
      else setProfiles(data || []);
      setLoading(false);
    })();
  }, []);

  const director = useMemo(() => profiles.find((p) => p.role === "director"), [profiles]);
  const vpProfile = useMemo(() => profiles.find((p) => p.role === "vp"), [profiles]);
  const managers = useMemo(() => profiles.filter((p) => p.role === "manager"), [profiles]);
  const sellers = useMemo(() => profiles.filter((p) => ["rep", "manager"].includes(p.role)), [profiles]);

  const base = Number(baseline) || 0;
  const amt = (o) => (o.mode === "pct" ? (base * (Number(o.value) || 0)) / 100 : Number(o.value) || 0);
  const mgrAmt = managerId ? amt(mgr) : 0;
  const dirAmt = amt(dir);
  const vpAmt = amt(vp);
  const repComm = Number(repCommission) || 0;
  const setterAmt = selfGen ? repComm : (repComm * (Number(setterSplit) || 0)) / 100;
  const closerAmt = selfGen ? 0 : repComm - setterAmt;
  const totalComm = repComm + mgrAmt + dirAmt + vpAmt;

  async function save() {
    setMsg(null);
    if (!dealName.trim()) return setMsg({ type: "err", text: "Deal name is required." });
    if (!base) return setMsg({ type: "err", text: "Baseline price is required." });
    if (!Number(jobPrice)) return setMsg({ type: "err", text: "Total deal value is required." });

    const primarySetter = selfGen ? repId : setterId;
    if (!primarySetter)
      return setMsg({ type: "err", text: selfGen ? "Select the rep who self-generated." : "Select a setter." });
    if (!selfGen && !closerId)
      return setMsg({ type: "err", text: "Select a closer, or toggle Self-generated." });

    setSaving(true);
    const payload = {
      deal_name: dealName.trim(),
      status,
      sale_date: saleDate,
      baseline_revenue: base,
      job_price: Number(jobPrice),
      setter_id: primarySetter,
      closer_id: selfGen ? null : closerId,
      setter_split_pct: selfGen ? 1 : (Number(setterSplit) || 0) / 100,
      setter_amount: setterAmt,
      closer_amount: selfGen ? null : closerAmt,
      manager_id: managerId || null,
      manager_amount: managerId ? mgrAmt : null,
      manager_override_pct: managerId && mgr.mode === "pct" ? (Number(mgr.value) || 0) / 100 : 0,
      director_id: director?.id || null,
      director_amount: dirAmt || null,
      director_override_pct: dir.mode === "pct" ? (Number(dir.value) || 0) / 100 : 0,
      vp_id: vpProfile?.id || null,
      vp_amount: vpAmt || null,
      vp_override_pct: vp.mode === "pct" ? (Number(vp.value) || 0) / 100 : 0,
    };

    const { error } = await supabase.from("deals").insert(payload);
    setSaving(false);
    if (error) return setMsg({ type: "err", text: error.message });

    setMsg({ type: "ok", text: `Saved "${payload.deal_name}".` });
    setDealName(""); setBaseline(""); setJobPrice(""); setRepCommission("");
    setRepId(""); setSetterId(""); setCloserId(""); setManagerId("");
    setMgr({ mode: "pct", value: "" });
    setDir({ mode: "pct", value: "5" });
    setVp({ mode: "pct", value: "5" });
  }

  return (
    <div className="ttd-nd">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        .ttd-nd{ --bg:#f6f7f5; --card:#fff; --line:#e3e6e1; --text:#1c2420;
          --muted:#6b746c; --green:#15803d; --green-dim:#dcfce7; --red:#dc2626;
          font-family:'Hanken Grotesk',-apple-system,sans-serif; color:var(--text);
          background:var(--bg); min-height:100%; padding:28px 22px 60px; box-sizing:border-box; }
        .ttd-nd *{ box-sizing:border-box; }
        .ttd-nd h1{ font-size:22px; font-weight:700; margin:0 0 2px; }
        .ttd-nd .lead{ color:var(--muted); font-size:13px; margin:0 0 22px; }
        .ttd-wrap{ display:grid; grid-template-columns:1fr 290px; gap:20px; align-items:start; max-width:920px; }
        @media(max-width:760px){ .ttd-wrap{ grid-template-columns:1fr; } }
        .card{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
        .card + .card{ margin-top:16px; }
        .sec{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);
          font-weight:600; margin:0 0 12px; }
        .row{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .row3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
        @media(max-width:520px){ .row,.row3{ grid-template-columns:1fr; } }
        label{ display:block; font-size:12px; font-weight:600; margin:0 0 5px; }
        input,select{ width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:9px;
          font:inherit; font-size:14px; background:#fff; color:var(--text); }
        input:focus,select:focus{ outline:none; border-color:var(--green); }
        .field{ margin-bottom:13px; }
        .toggle{ display:inline-flex; border:1px solid var(--line); border-radius:9px; overflow:hidden; }
        .toggle button{ border:0; background:#fff; padding:8px 16px; font:inherit; font-size:13px;
          font-weight:600; color:var(--muted); cursor:pointer; }
        .toggle button.on{ background:var(--green); color:#fff; }
        .modetog{ display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
        .modetog button{ border:0; background:#fff; padding:8px 11px; font:inherit; font-weight:700;
          color:var(--muted); cursor:pointer; min-width:34px; }
        .modetog button.on{ background:var(--text); color:#fff; }
        .splitline{ display:flex; gap:8px; align-items:flex-end; }
        .splitline .modetog{ flex:none; }
        .splitline input{ flex:1; }
        .liveamt{ font-size:12px; color:var(--green); font-weight:600; margin-top:5px; }
        .summary{ position:sticky; top:18px; }
        .sumrow{ display:flex; justify-content:space-between; font-size:13px; padding:7px 0;
          border-bottom:1px dashed var(--line); }
        .sumrow span:last-child{ font-weight:600; }
        .sumtotal{ display:flex; justify-content:space-between; margin-top:10px; padding-top:10px;
          border-top:2px solid var(--text); font-size:15px; font-weight:700; }
        .save{ width:100%; margin-top:16px; padding:12px; border:0; border-radius:10px;
          background:var(--green); color:#fff; font:inherit; font-size:15px; font-weight:700; cursor:pointer; }
        .save:disabled{ opacity:.5; cursor:default; }
        .msg{ margin-top:12px; padding:10px 12px; border-radius:9px; font-size:13px; font-weight:600; }
        .msg.ok{ background:var(--green-dim); color:var(--green); }
        .msg.err{ background:#fee2e2; color:var(--red); }
      `}</style>

      <h1>New Deal</h1>
      <p className="lead">Enter a deal manually. Amounts save straight to the dashboard.</p>

      {loading ? (
        <p className="lead">Loading team…</p>
      ) : (
        <div className="ttd-wrap">
          <div>
            <div className="card">
              <p className="sec">Deal</p>
              <div className="field">
                <label>Deal name</label>
                <input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="e.g. Smith — 1423 Mesa Dr" />
              </div>
              <div className="row">
                <div className="field">
                  <label>Sale date</label>
                  <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="row3">
                <div className="field">
                  <label>Baseline price</label>
                  <input type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} placeholder="0.00" />
                </div>
                <div className="field">
                  <label>Total deal value</label>
                  <input type="number" value={jobPrice} onChange={(e) => setJobPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="field">
                  <label>Rep commission</label>
                  <input type="number" value={repCommission} onChange={(e) => setRepCommission(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>

            <div className="card">
              <p className="sec">Sale source</p>
              <div className="toggle" style={{ marginBottom: 14 }}>
                <button className={!selfGen ? "on" : ""} onClick={() => setSelfGen(false)}>Setter + Closer</button>
                <button className={selfGen ? "on" : ""} onClick={() => setSelfGen(true)}>Self-generated</button>
              </div>

              {selfGen ? (
                <div className="field">
                  <label>Rep (gets 100% of rep commission)</label>
                  <select value={repId} onChange={(e) => setRepId(e.target.value)}>
                    <option value="">Select rep…</option>
                    {sellers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="liveamt">Rep gets {money(setterAmt)}</div>
                </div>
              ) : (
                <>
                  <div className="row">
                    <div className="field">
                      <label>Setter</label>
                      <select value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                        <option value="">Select…</option>
                        {sellers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Closer</label>
                      <select value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                        <option value="">Select…</option>
                        {sellers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>Setter split — {setterSplit}% setter / {100 - setterSplit}% closer</label>
                    <input type="range" min="0" max="100" value={setterSplit} onChange={(e) => setSetterSplit(Number(e.target.value))} />
                    <div className="liveamt">Setter {money(setterAmt)} · Closer {money(closerAmt)}</div>
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <p className="sec">Overrides</p>
              <div className="field">
                <label>Manager</label>
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">None</option>
                  {managers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {managerId && (
                <div className="field">
                  <label>Manager override</label>
                  <div className="splitline">
                    <div className="modetog">
                      <button className={mgr.mode === "pct" ? "on" : ""} onClick={() => setMgr({ ...mgr, mode: "pct" })}>%</button>
                      <button className={mgr.mode === "amt" ? "on" : ""} onClick={() => setMgr({ ...mgr, mode: "amt" })}>$</button>
                    </div>
                    <input type="number" value={mgr.value} onChange={(e) => setMgr({ ...mgr, value: e.target.value })}
                      placeholder={mgr.mode === "pct" ? "% of baseline" : "$ amount"} />
                  </div>
                  <div className="liveamt">{money(mgrAmt)}</div>
                </div>
              )}

              <div className="field">
                <label>Director — {director ? director.name : "not set"} (default 5%)</label>
                <div className="splitline">
                  <div className="modetog">
                    <button className={dir.mode === "pct" ? "on" : ""} onClick={() => setDir({ ...dir, mode: "pct" })}>%</button>
                    <button className={dir.mode === "amt" ? "on" : ""} onClick={() => setDir({ ...dir, mode: "amt" })}>$</button>
                  </div>
                  <input type="number" value={dir.value} onChange={(e) => setDir({ ...dir, value: e.target.value })}
                    placeholder={dir.mode === "pct" ? "% of baseline" : "$ amount"} />
                </div>
                <div className="liveamt">{money(dirAmt)}</div>
              </div>

              <div className="field">
                <label>VP — {vpProfile ? vpProfile.name : "not set"} (default 5%)</label>
                <div className="splitline">
                  <div className="modetog">
                    <button className={vp.mode === "pct" ? "on" : ""} onClick={() => setVp({ ...vp, mode: "pct" })}>%</button>
                    <button className={vp.mode === "amt" ? "on" : ""} onClick={() => setVp({ ...vp, mode: "amt" })}>$</button>
                  </div>
                  <input type="number" value={vp.value} onChange={(e) => setVp({ ...vp, value: e.target.value })}
                    placeholder={vp.mode === "pct" ? "% of baseline" : "$ amount"} />
                </div>
                <div className="liveamt">{money(vpAmt)}</div>
              </div>
            </div>
          </div>

          <div className="card summary">
            <p className="sec">Summary</p>
            <div className="sumrow"><span>Baseline</span><span>{money(base)}</span></div>
            <div className="sumrow"><span>Total deal value</span><span>{money(Number(jobPrice) || 0)}</span></div>
            <div className="sumrow"><span>Setter</span><span>{money(setterAmt)}</span></div>
            {!selfGen && <div className="sumrow"><span>Closer</span><span>{money(closerAmt)}</span></div>}
            {managerId && <div className="sumrow"><span>Manager</span><span>{money(mgrAmt)}</span></div>}
            <div className="sumrow"><span>Director</span><span>{money(dirAmt)}</span></div>
            <div className="sumrow"><span>VP</span><span>{money(vpAmt)}</span></div>
            <div className="sumtotal"><span>Total commission</span><span>{money(totalComm)}</span></div>
            <button className="save" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save deal"}</button>
            {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
