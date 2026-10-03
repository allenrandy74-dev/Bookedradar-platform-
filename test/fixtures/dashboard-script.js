// This helper extracts the sole plain inline script from repository-owned test
// fixtures. It is not a general HTML parser, sanitizer, or security boundary.
export function extractFixtureScript(html) {
  // Fold ASCII tag casing without changing Unicode offsets or script contents.
  const tags = html.replace(/[A-Z]/g, character => character.toLowerCase());
  const opening = '<script>';
  const closing = '</script>';
  const start = tags.indexOf(opening);
  const end = tags.indexOf(closing);
  if (start < 0 || end < start + opening.length ||
      tags.indexOf(opening, start + opening.length) !== -1 ||
      tags.indexOf(closing, end + closing.length) !== -1) {
    throw new Error('Expected one plain inline script in the repository fixture');
  }
  return html.slice(start + opening.length, end);
}
