import { checkProfile } from '../model/probe.js';

export function localEndpoint(profile) {
  const url = new URL(profile.config.baseUrl);
  if (!profile.model || profile.metadata.is_mock || !['http:', 'https:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Requires a configured local real model profile.');
  return url;
}
export async function inspectLocalModel(profile) {
  const url = localEndpoint(profile); let metadataRequests = 0;
  try {
    const get = async (path) => {
      metadataRequests++; const res = await fetch(new URL(path, url.origin), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(); return res.json();
    };
    const tags = await get('/api/tags'), ps = await get('/api/ps');
    const matches = (m) => (m.name || m.model) === profile.config.name || (m.name || m.model) === `${profile.config.name}:latest`;
    const installed = !!tags.models?.some(matches), loaded = !!ps.models?.some(matches);
    return { status: installed ? 'PASS' : 'BLOCKED', installed, loaded, metadata_requests: metadataRequests, model_requests: 0,
      suggestion: installed ? loaded ? 'Model is loaded; run an explicit probe.' : 'Model is installed but not loaded; run exam:model --action=warm.' : `Model missing. Install it yourself: ollama pull "${profile.config.name}"` };
  } catch { return { status: 'BLOCKED', installed: null, loaded: null, metadata_requests: metadataRequests, model_requests: 0, suggestion: 'Ollama metadata is unavailable. Start the local service yourself; no model was downloaded or called.' }; }
}
export async function warmProfile(profile, { timeoutMs = 60000 } = {}) {
  localEndpoint(profile);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Warm timeout must be finite and at most 120000 ms.');
  return checkProfile(profile, { timeoutMs, kind: 'warm' });
}
