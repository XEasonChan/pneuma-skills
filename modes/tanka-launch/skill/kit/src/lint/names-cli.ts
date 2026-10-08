// CLI for the names lint (not part of the kit's bundle): node <kit>/src/lint/names-cli.ts <scenes.json> [--json] [--allow A,B]
// Prints one warning per line (or JSON) and exits 1 when there are warnings. Node ≥ 23.6 strips the types itself.
// @ts-nocheck  (node globals: the kit's tsconfig has no node types)
import {readFileSync} from 'node:fs';
import {lintNames, formatNameWarnings} from './names.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--allow');
if (!file) { console.error('usage: names-cli.ts <scenes.json> [--json] [--allow A,B]'); process.exit(2); }
const ai = args.indexOf('--allow');
const w = lintNames(readFileSync(file, 'utf8'), {allow: ai >= 0 ? args[ai + 1].split(',') : []});
console.log(args.includes('--json') ? JSON.stringify(w, null, 1) : formatNameWarnings(w));
process.exitCode = w.length ? 1 : 0;
