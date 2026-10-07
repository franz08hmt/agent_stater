// The allow-list. The model can ASK for any tool name; only names registered here
// can ever execute, and only with arguments that pass schema + business rules.

import { validate } from './schema.js';
import { searchNotes } from './searchNotes.js';
import { saveDraft } from './saveDraft.js';
import { queryDataset, createQueryDatasetTool } from './queryDataset.js';

export const BUILTIN_TOOLS = Object.freeze({ search_notes: searchNotes, save_draft: saveDraft, query_dataset: queryDataset });

export function createConfiguredToolRegistry(names, datasets = []) {
  if (!Array.isArray(names) || !names.length || names.some((name) => !Object.hasOwn(BUILTIN_TOOLS, name))) {
    throw new Error('Task allowed_tools contains an unavailable tool.');
  }
  return createToolRegistry(names.map((name) => name === 'query_dataset' ? createQueryDatasetTool(datasets) : BUILTIN_TOOLS[name]));
}

const MAX_ARGUMENT_BYTES = 6000;
const ACCESS_LEVELS = ['read', 'write'];

/**
 * Declaration rules, enforced when the registry is built so a mistake fails at startup
 * (with the tool's name) instead of surfacing as an unapproved write during a demo.
 *  - access must be exactly 'read' or 'write' (a missing/typo'd value must not skip the rule below)
 *  - every 'write' tool must set requiresApproval to the boolean true (a truthy string is not enough)
 *  - tool names are unique (a later tool must not silently replace an earlier one)
 */
export function assertToolDeclarations(tools) {
  const seen = new Set();
  for (const tool of tools) {
    const name = typeof tool?.name === 'string' && tool.name ? tool.name : '(unnamed)';
    if (!ACCESS_LEVELS.includes(tool?.access)) {
      throw new Error(`Tool "${name}" must declare access: 'read' or 'write' (got ${JSON.stringify(tool?.access)}).`);
    }
    if (tool.access === 'write' && tool.requiresApproval !== true) {
      throw new Error(`Tool "${name}" has access: 'write' but requiresApproval is not true. Every write tool must require human approval.`);
    }
    if (seen.has(name)) throw new Error(`Duplicate tool name "${name}".`);
    seen.add(name);
  }
}

export function createToolRegistry(tools = [searchNotes, saveDraft]) {
  assertToolDeclarations(tools);
  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    /** Descriptions shown to the model inside the system prompt. */
    describe() {
      return tools.map((t) => ({
        name: t.name,
        access: t.access,
        requires_approval: t.requiresApproval,
        description: t.description,
        arguments_schema: t.schema,
      }));
    },

    get: (name) => byName.get(name),

    /**
     * Gatekeeper for every proposed call.
     * @returns {{ ok: true, tool } | { ok: false, code, errors: string[] }}
     */
    check(name, args, ctx) {
      const tool = byName.get(name);
      if (!tool) return { ok: false, code: 'tool_not_allowed', errors: [`Tool "${name}" is not in the allow-list.`] };
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return { ok: false, code: 'invalid_arguments', errors: ['arguments must be a JSON object.'] };
      }
      if (JSON.stringify(args).length > MAX_ARGUMENT_BYTES) {
        return { ok: false, code: 'invalid_arguments', errors: [`arguments exceed ${MAX_ARGUMENT_BYTES} bytes.`] };
      }
      const schemaErrors = validate(tool.schema, args);
      if (schemaErrors.length) return { ok: false, code: 'invalid_arguments', errors: schemaErrors };
      const ruleErrors = tool.checkRules(args, ctx);
      if (ruleErrors.length) return { ok: false, code: 'rule_violation', errors: ruleErrors };
      return { ok: true, tool };
    },
  };
}
