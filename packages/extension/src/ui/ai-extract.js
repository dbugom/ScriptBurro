/** Returns the userscript from the first fenced code block that has a metadata header. */
export function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.find((b) => b.includes('==UserScript==')) || null;
}
