const text = (value) => typeof value === 'string' ? value : JSON.stringify(value);
// Presentation only. The POST approval keeps the untouched backend args_hash.
export function approvalRows(pending, task) {
  const args = pending.arguments;
  if (pending.result_kind !== 'proposal' || !Array.isArray(args.references)) return Object.entries(args).map(([k,v]) => [k,text(v)]);
  const rows = [['Action', text(args.action)]];
  for (const ref of args.references) {
    const snapshot = task?.data?.datasets?.find((d) => d.id === ref.dataset_id)?.version ?? 'unavailable';
    const extra = Object.fromEntries(Object.entries(ref).filter(([k]) => !['role','dataset_id','record_id','source_id'].includes(k)));
    rows.push([ref.role === 'subject' ? 'Subject' : ref.role === 'target' ? 'Target' : String(ref.role),
      `${ref.dataset_id} / ${ref.record_id} · ${ref.source_id} · snapshot ${snapshot}${Object.keys(extra).length ? ` · ${text(extra)}` : ''}`]);
  }
  rows.push(['Changes',text(args.changes)], ['Reason',text(args.reason)]);
  for (const [key,value] of Object.entries(args)) if (!['action','references','changes','reason'].includes(key)) rows.push([key,text(value)]);
  return rows;
}
