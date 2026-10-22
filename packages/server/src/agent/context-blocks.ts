// Tag-wrapped blocks the app gives the agent: hidden context and JSON it cannot break out of.
/**
 * JSON for a tag-wrapped block the agent reads, such as `<app_context>`: `<` is escaped as `\u003c`,
 * so text inside (a page summary, a Topic name) can never close the tag or open another one. The
 * JSON still parses to the same value.
 */
export function inertJson(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(/</g, "\\u003c");
}

/** A hidden context block the app gives the agent. */
export function appContext(name: string, data: unknown, space: number | undefined = 2): string {
  return `<app_context name="${name}">\n${inertJson(data, space)}\n</app_context>`;
}
