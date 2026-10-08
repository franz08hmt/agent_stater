import { decimalUnits } from '../data/datasets.js';
export const ASSET_QUANTITY_SCHEMA = { type: 'integer', minimum: 1, maximum: 20 };
// Whole units only. This check never reserves or books anything.
export function assetAvailability(record, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('quantity must be an integer from 1 to 20.');
  if (!record) return { available: null, requested: quantity, eligible: false };
  const available = decimalUnits(record.available, 0);
  if (available < 0n) throw new Error('Asset available quantity must be nonnegative.');
  return { available: String(available), requested: quantity, eligible: available >= BigInt(quantity) };
}
export function assertAssetDataset(data) {
  if (!data.columns.some((c) => c.name === 'available' && c.type === 'number' && (c.scale ?? 0) === 0)) throw new Error('Asset dataset requires available:number with scale 0.');
  for (const row of data.rows) assetAvailability(row, 1);
}
