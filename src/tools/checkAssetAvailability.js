import { createQueryDatasetTool } from './queryDataset.js';
import { DATASET_LIMITS } from '../data/datasets.js';
import { ASSET_QUANTITY_SCHEMA, assetAvailability, assertAssetDataset } from '../business/assetAvailability.js';
export function createCheckAssetAvailabilityTool(datasets = []) {
  const engine = createQueryDatasetTool(datasets, { observationToolName: 'check_asset_availability' });
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const lookup = (args) => ({ dataset_id: args.dataset_id, operation: 'lookup', filters: [{ field: byId.get(args.dataset_id).idColumn, op: 'eq', value: args.record_id }], limit: 1 });
  return {
    name: 'check_asset_availability', access: 'read', requiresApproval: false,
    description: 'Check whole-unit asset availability; never reserve, book or confirm a loan. Arguments dataset_id, record_id, quantity (integer 1..20). Returns lookup source and exact availability decision; missing record is not eligible. '
      + `Allowed datasets: ${JSON.stringify(datasets.map((d) => ({ id: d.id, id_column: d.idColumn })))}`,
    schema: { type: 'object', additionalProperties: false, required: ['dataset_id', 'record_id', 'quantity'], properties: {
      dataset_id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' }, record_id: { type: 'string', minLength: 1, maxLength: 500 }, quantity: ASSET_QUANTITY_SCHEMA,
    } },
    checkRules(args) {
      const data = byId.get(args.dataset_id);
      if (!data) return ['Asset dataset is outside the task allow-list.'];
      try { assertAssetDataset(data); assetAvailability(null, args.quantity); return engine.checkRules(lookup(args)); }
      catch (e) { return [e.message]; }
    },
    captureEvidence(args, output) { return engine.captureEvidence(lookup(args), output); },
    async execute(args) {
      const errors = this.checkRules(args); if (errors.length) throw new Error(errors.join('; '));
      const output = await engine.execute(lookup(args)), e = output.results[0];
      Object.assign(e, assetAvailability(e.rows[0]?.record, args.quantity));
      if (JSON.stringify({ tool: this.name, status: 'ok', untrusted_data: output }).length > DATASET_LIMITS.maxResultChars) throw new Error('Asset result exceeds observation limit.');
      return output;
    },
  };
}
export const checkAssetAvailability = createCheckAssetAvailabilityTool();
