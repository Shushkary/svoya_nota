const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = [
  path.join(root, 'src', 'ui', 'tabs', 'Nutrition.jsx'),
  path.join(root, 'src', 'ui', 'tabs', 'Practice.jsx'),
  path.join(root, 'index.html'),
];

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\bsrcDoc\b|<iframe\b/i.test(source)) violations.push(`${path.basename(file)} still creates an iframe/srcDoc`);
  if (/sha256-/i.test(source)) violations.push(`${path.basename(file)} still contains a CSP script hash`);
}

if (violations.length) throw new Error(violations.join('\n'));
console.log("CSP check: iframe/srcDoc and inline-script hashes are absent; use script-src 'self'.");
