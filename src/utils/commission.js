// Percentages are decimals: 0.5 = 50%, 0.04 = 4%.
// Prefer stored $ amounts; fall back to % math.
// Self-generated/solo deals (no closer) give 100% of rep commission to the setter.

const num = (v) => (v == null ? 0 : Number(v) || 0);

export function dealAmounts(deal) {
  const baseline = num(deal.baseline_revenue);
  const job = num(deal.job_price);
  const repPool = Math.max(job - baseline, 0);

  const solo = !deal.closer_id || deal.setter_id === deal.closer_id;
  const split = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct);

  const setter =
    deal.setter_amount != null ? num(deal.setter_amount) : repPool * (solo ? 1 : split);
  const closer =
    deal.closer_amount != null ? num(deal.closer_amount) : solo ? 0 : repPool * (1 - split);
  const manager =
    deal.manager_amount != null ? num(deal.manager_amount) : baseline * num(deal.manager_override_pct);
  const director =
    deal.director_amount != null ? num(deal.director_amount) : baseline * num(deal.director_override_pct);
  const vp =
    deal.vp_amount != null ? num(deal.vp_amount) : baseline * num(deal.vp_override_pct);

  const repCommission = setter + closer;
  const overrides = manager + director + vp;

  return {
    baseline, job, setter, closer, manager, director, vp,
    repCommission, overrides, totalCommission: repCommission + overrides,
  };
}

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
