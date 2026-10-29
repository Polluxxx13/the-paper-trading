// Lance tous les fichiers *.test.js du dossier, un par un, et résume. Usage : node tests/run.js [filtre]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filter = process.argv[2];
const files = fs.readdirSync(__dirname).filter((f) => /\.test\.c?js$/.test(f) && (!filter || f.includes(filter))).sort();
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = out.trim().split('\n').filter((l) => /réussis|CRASH/.test(l)).pop() ?? '(aucun résumé)';
  const bad = out.split('\n').filter((l) => l.startsWith('FAIL') || l.includes('CRASH'));
  console.log(`${r.status === 0 ? '✔' : '✘'} ${f.padEnd(24)} ${summary.trim()}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (r.status !== 0) { failed++; bad.forEach((l) => console.log('    ' + l)); if (!bad.length) console.log(out.split('\n').slice(-12).map((l) => '    ' + l).join('\n')); }
}
console.log(failed ? `\n${failed} fichier(s) en échec` : `\nTous les tests passent (${files.length} fichiers)`);
process.exit(failed ? 1 : 0);
