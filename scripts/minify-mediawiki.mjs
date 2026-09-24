import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {minify} from 'terser';

const root = fileURLToPath(new URL('..', import.meta.url));
const input = resolve(root, 'mediawiki/cgss-mediawiki.js');
const output = resolve(root, 'mediawiki/cgss-mediawiki.min.js');

function splitHeader(source) {
  const match = source.match(/^(\/\*[\s\S]*?\*\/)[\r\n]*/);
  if (!match) throw new Error('MediaWiki source is missing its leading license block.');
  return {header: match[1], code: source.slice(match[0].length)};
}

function minifiedHeader(header) {
  const notice =
    ' * Minified distribution. Read cgss-mediawiki.js for the uncompressed source.\n';
  return header.replace('\n', `\n${notice}`);
}

export async function buildMinifiedMediaWiki(check = false, source = null) {
  source ??= await readFile(input, 'utf8');
  const {header, code} = splitHeader(source.replaceAll('\r\n', '\n'));
  const result = await minify(code, {
    ecma: 2020,
    compress: {passes: 3, toplevel: true},
    mangle: {toplevel: true},
    format: {ascii_only: true, comments: false, semicolons: true}
  });
  if (!result.code) throw new Error('MediaWiki minifier produced no JavaScript.');
  const content = `${minifiedHeader(header)}\n${result.code}\n`;
  let existing;
  try { existing = await readFile(output, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing === content) return false;
  if (check) throw new Error('Out of sync: mediawiki/cgss-mediawiki.min.js. Run npm run build:mediawiki.');
  await writeFile(output, content);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const check = process.argv.includes('--check');
  await buildMinifiedMediaWiki(check);
  console.log(check ? 'Minified MediaWiki script is in sync.' : 'Minified MediaWiki script updated.');
}
