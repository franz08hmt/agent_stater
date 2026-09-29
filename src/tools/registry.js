// The allow-list. The model can ASK for any tool name; only names registered here
// can ever execute, and only with arguments that pass schema + business rules.

import { validate } from './schema.js';
import { searchNotes } from './searchNotes.js';
import { saveDraft } from './saveDraft.js';

const MAX_ARGUMENT_BYTES = 6000;

export function createToolRegistry(tools = [searchNotes, saveDraft]) {
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
