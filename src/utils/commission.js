const num = (v) => (v == null ? 0 : Number(v) || 0);

export function dealAmounts(deal) {
  const baseline = num(deal.baseline_revenue);
  const job = num(deal.job_price);
  const repPool = Math.max(job - baseline, 0);
  const solo = !deal.closer_id || deal.setter_id === deal.closer_id;
  const split = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct);
  const setter = deal.setter_amount != null ? num(deal.setter_amount) : repPool * (solo ? 1 : split);
  const closer = deal.closer_amount != null ? num(deal.closer_amount) : solo ? 0 : repPool * (1 - split);
  const manager = deal.manager_amount != null ? num(deal.manager_amount) : baseline * num(deal.manager_override_pct);
  const director = deal.director_amount != null ? num(deal.director_amount) : baseline * num(deal.director_override_pct);
  const vp = deal.vp_amount != null ? num(deal.vp_amount) : baseline * num(deal.vp_override_pct);
  const repCommission = setter + closer;
  const overrides = manager + director + vp;
  const totalCommission = repCommission + overrides;
  return { baseline, job, setter, closer, manager, director, vp, repCommission, overrides, totalCommission };
}

// Backward-compatible wrapper — preserves old property names used by DealTable
export const calcDealCommissions = (deal) => {
  const r = dealAmounts(deal);
  return {
    ...r,
    gross:     r.totalCommission,
    setterAmt: r.setter,
    closerAmt: r.closer,
    commPct:   r.job > 0 ? r.totalCommission / r.job : 0,
  };
};

export const getUserCommission = (deals, userId) => {
  return (deals || [])
    .filter((d) => d.setter_id === userId || d.closer_id === userId)
    .reduce((sum, d) => {
      const a = dealAmounts(d);
      if (d.setter_id === userId) sum += a.setter;
      if (d.closer_id === userId) sum += a.closer;
      return sum;
    }, 0);
};

export function rollup(deals) {
  return (deals || []).reduce(
    (acc, d) => {
      const a = dealAmounts(d);
      acc.count += 1;
      acc.baselineRevenue += a.baseline;
      acc.jobRevenue += a.job;
      acc.commission += a.totalCommission;
      return acc;
    },
    { count: 0, baselineRevenue: 0, jobRevenue: 0, commission: 0 }
  );
}

export const fmt = (n) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (n) => ((Number(n) || 0) * 100).toFixed(1) + "%";
