import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'ChronoPlanner-可直接開啟.html');
const modules = ['model.js', 'scheduler.js', 'analytics.js', 'importer.js', 'app.js'];
const template = await readFile(output, 'utf8');
const codeStart = template.indexOf('// ---- src/model.js ----');
const codeEnd = template.indexOf('</script>', codeStart);

if (codeStart < 0 || codeEnd < 0) throw new Error('找不到單檔版的程式區段標記');

const stripModuleSyntax = source => source
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+(?=(const|function|class)\b)/gm, '');

const bundled = (await Promise.all(modules.map(async file => {
  const source = stripModuleSyntax(await readFile(join(root, 'src', file), 'utf8'));
  return `// ---- src/${file} ----\n${source.trimEnd()}\n`;
}))).join('\n');

await writeFile(output, `${template.slice(0, codeStart)}${bundled}\n})();\n${template.slice(codeEnd)}`);
console.log(`Built ${output} from ${modules.length} source modules.`);
