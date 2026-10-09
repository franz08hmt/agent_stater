// Tiny strict argument parser for the rag:* commands: --name=value, no positional arguments,
// unknown or repeated options are refused so a typo can never silently change behaviour.

/** @param spec {Record<string,'string'|'int'|'flag'>} */
export function parseArgs(argv, spec) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/s.exec(arg);
    if (!m || !Object.hasOwn(spec, m[1])) throw new Error(`Unknown argument: ${arg.slice(0, 60)}`);
    const [, name, value] = m;
    if (Object.hasOwn(out, name)) throw new Error(`Argument given twice: --${name}`);
    if (spec[name] === 'flag') { if (value !== undefined) throw new Error(`--${name} takes no value.`); out[name] = true; continue; }
    if (value === undefined || value === '') throw new Error(`--${name} needs a value.`);
    if (spec[name] === 'int') {
      if (!/^[0-9]{1,9}$/.test(value)) throw new Error(`--${name} must be a whole number.`);
      out[name] = Number(value);
    } else out[name] = value;
  }
  return out;
}
