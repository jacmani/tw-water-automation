/**
 * Tolerant JSON parser for LLM output, shared by every engine that asks a
 * model to return structured JSON (Gemini, Claude Haiku, and any future
 * engine). Originally lived only in geminiVision.ts; moved here after a
 * production incident (2026-07-05) where Claude Haiku's escalation call in
 * anthropic.ts used a single fragile regex with no truncation handling —
 * a response that got cut off before its closing ``` fence (most likely
 * from hitting max_tokens on a sheet with many flagged_fields) fell through
 * to raw fenced text, crashed JSON.parse, and surfaced a raw "Unexpected
 * token" SyntaxError straight to the technician mid-upload instead of being
 * repaired or failing gracefully. See CLAUDE.md and ClickUp for the incident.
 *
 * Repairs, in order:
 *   - markdown fences ```json ... ```
 *   - leading/trailing prose around the object
 *   - trailing commas before } or ]
 *   - unquoted NaN / Infinity (→ null)
 *   - truncated output (close dangling brackets/strings so the valid
 *     prefix parses instead of failing outright)
 *
 * Returns null if nothing salvageable — callers should treat that as a
 * genuine extraction failure (retry / escalate / surface a friendly error),
 * never let the raw SyntaxError reach the end user.
 */
export function parseLenientJson(raw: string): unknown {
  let s = raw.trim();

  // Strip markdown fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  // Narrow to the outermost object.
  const start = s.indexOf('{');
  if (start > 0) s = s.slice(start);

  const attempts: string[] = [s];

  // Repair pass 1: remove trailing commas, normalise NaN/Infinity.
  const repaired = s
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\b(NaN|Infinity|-Infinity)\b/g, 'null');
  attempts.push(repaired);

  // Repair pass 2: if truncated, close any open brackets/strings on the repaired text.
  attempts.push(closeTruncatedJson(repaired));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch { /* try next */ }
  }
  return null;
}

/** Best-effort: balance unclosed strings/brackets in truncated JSON. */
export function closeTruncatedJson(s: string): string {
  let out = s;
  // If we're inside an unterminated string, close it.
  const quotes = (out.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 === 1) out += '"';
  // Drop any dangling trailing comma.
  out = out.replace(/,\s*$/, '');
  // Close brackets in the right order using a stack.
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of out) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']';
  }
  return out;
}
