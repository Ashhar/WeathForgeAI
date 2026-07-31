/* ============================================================
   WealthForge AI — cloud sync (Supabase ⇄ Store)
   The client stays the single source of truth for valuation math;
   Supabase stores the raw records. Each table row keeps the rich
   client model in `metadata` plus denormalized reporting columns
   (value / balance) refreshed on every write. Mutations flow
   through Store.setOnMutate → push() fire-and-forget upserts.
   ============================================================ */

const Cloud = (() => {
  const sb = () => Supa.client;
  const userId = () => Auth.session ? Auth.session.user.id : null;

  // ---------- mapping: client model ⇄ table rows ----------
  function assetToRow(a) {
    const d = a.data || {};
    let value = 0;
    try { value = Math.round(Store.valuation(a).currentValue || 0); } catch (e) { /* keep 0 */ }
    const { id, ...meta } = a;
    return {
      id: a.id,
      user_id: userId(),
      name: a.label || 'Unnamed asset',
      category: a.type,
      value,
      quantity: d.quantity != null ? d.quantity : (d.units != null ? d.units : (d.grams != null ? d.grams : (d.totalUnits != null ? d.totalUnits : null))),
      valuation_mode: a.valuationMode || (Store.TYPES[a.type] ? Store.TYPES[a.type].mode : 'manual'),
      metadata: meta,
    };
  }
  function rowToAsset(row) {
    const a = { ...(row.metadata || {}) };
    a.id = row.id;
    a.label = a.label || row.name;
    a.type = a.type || row.category;
    return a;
  }

  function liabilityToRow(l) {
    let balance = l.principal || 0;
    try { balance = Math.round(Store.liabilityValuation(l).balance || 0); } catch (e) { /* keep principal */ }
    const { id, ...meta } = l;
    return {
      id: l.id,
      user_id: userId(),
      name: l.label || 'Liability',
      type: l.type,
      balance,
      interest_rate: l.rate != null ? l.rate : null,
      metadata: meta,
    };
  }
  function rowToLiability(row) {
    const l = { ...(row.metadata || {}) };
    l.id = row.id;
    l.label = l.label || row.name;
    l.type = l.type || row.type;
    return l;
  }

  function snapToRow(s) {
    return {
      user_id: userId(),
      snapshot_date: s.date,
      total_assets: s.totalAssets,
      total_liabilities: s.totalLiabilities,
      net_worth: s.netWorth,
      breakdown: s.byType || {},
    };
  }
  function rowToSnap(row) {
    return {
      date: row.snapshot_date,
      totalAssets: Number(row.total_assets),
      totalLiabilities: Number(row.total_liabilities),
      netWorth: Number(row.net_worth),
      byType: row.breakdown || {},
    };
  }

  function goalToRow(g) {
    return {
      id: g.id,
      user_id: userId(),
      title: g.title,
      target_amount: g.targetAmount,
      target_date: g.targetDate || null,
      achieved: !!g.achieved,
      achieved_at: g.achievedAt || null,
    };
  }
  function rowToGoal(row) {
    return {
      id: row.id,
      title: row.title,
      targetAmount: Number(row.target_amount),
      targetDate: row.target_date,
      achieved: !!row.achieved,
      achievedAt: row.achieved_at,
      createdAt: row.created_at,
    };
  }

  // ---------- load everything for the signed-in user ----------
  async function loadAll() {
    const uid = userId();
    if (!uid) return;
    const [assetsQ, liabsQ, snapsQ, goalsQ] = await Promise.all([
      sb().from('assets').select('*').order('created_at'),
      sb().from('liabilities').select('*').order('created_at'),
      sb().from('net_worth_snapshots').select('*').order('snapshot_date'),
      sb().from('goals').select('*').order('created_at'),
    ]);
    const err = assetsQ.error || liabsQ.error || snapsQ.error || goalsQ.error;
    if (err) {
      UI.toast('Could not load your data: ' + err.message);
      return;
    }
    Store.setRemote({
      assets: (assetsQ.data || []).map(rowToAsset),
      liabilities: (liabsQ.data || []).map(rowToLiability),
      snapshots: (snapsQ.data || []).map(rowToSnap),
      goals: (goalsQ.data || []).map(rowToGoal),
    }, { readOnly: Auth.isDemo() });
    Store.setOnMutate(push);
  }

  // ---------- write-through ----------
  function report(error) {
    if (error) UI.toast('Cloud sync failed: ' + error.message);
  }
  function push(collection, op, record) {
    if (!Auth.enabled() || !userId()) return;
    if (op === 'delete') {
      const table = collection === 'snapshots' ? 'net_worth_snapshots' : collection;
      sb().from(table).delete().eq('id', record.id).then(({ error }) => report(error));
      return;
    }
    if (collection === 'assets') {
      sb().from('assets').upsert(assetToRow(record)).then(({ error }) => report(error));
    } else if (collection === 'liabilities') {
      sb().from('liabilities').upsert(liabilityToRow(record)).then(({ error }) => report(error));
    } else if (collection === 'snapshots') {
      sb().from('net_worth_snapshots')
        .upsert(snapToRow(record), { onConflict: 'user_id,snapshot_date' })
        .then(({ error }) => report(error));
    } else if (collection === 'goals') {
      sb().from('goals').upsert(goalToRow(record)).then(({ error }) => report(error));
    }
  }

  return { loadAll };
})();

if (typeof globalThis !== 'undefined') globalThis.Cloud = Cloud;
