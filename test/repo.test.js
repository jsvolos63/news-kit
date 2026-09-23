// Cross-file invariants of THIS repo — rules whose two halves live in different
// files, which no other check reads side by side. Each used to be prose only (a
// workflow comment, a CLAUDE.md paragraph, a MAINTENANCE.md row), and prose does
// not hold: the check-command rule below had already drifted when it was
// mechanized. The same shape as pwa-kit's test-repo.mjs.
//
// Every parse FAILS when it finds nothing, rather than comparing two empty
// lists and passing — a check that could not read its input must never read as
// "the files agree".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const workflow = (file) => read(`.github/workflows/${file}`);
const pkg = JSON.parse(read('package.json'));

const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');
// A YAML line with a trailing ` # comment` — the comment is not the value.
const uncomment = (line) => line.replace(/\s+#.*$/, '');

function topLevelName(yaml, file) {
  const m = yaml.match(/^name:\s*(.+?)\s*$/m);
  assert.ok(m, `${file}: no top-level name:`);
  return unquote(uncomment(m[1]).trim());
}

function workflowRunTargets(yaml, file) {
  const m = yaml.match(/^\s*workflows:\s*\[([^\]]*)\]\s*(?:#.*)?$/m);
  assert.ok(m, `${file}: no workflow_run \`workflows: [...]\` list`);
  const names = m[1].split(',').map((s) => unquote(s.trim())).filter(Boolean);
  assert.ok(names.length > 0, `${file}: empty workflows: list`);
  return names;
}

// The lines of a `key: |` block scalar, trimmed, blank and comment lines
// dropped. Fails if the key is missing or the block is empty.
function blockScalar(yaml, key, file) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*\\|\\s*$`).test(l));
  assert.ok(start >= 0, `${file}: no \`${key}: |\` block`);
  const keyIndent = lines[start].match(/^\s*/)[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.match(/^\s*/)[0].length <= keyIndent) break;
    if (line.trim().startsWith('#')) continue;
    body.push(line.trim());
  }
  assert.ok(body.length > 0, `${file}: \`${key}: |\` block is empty`);
  return body;
}

// Bare package specifiers a module imports (static, re-export and dynamic),
// comment lines skipped. `node:` builtins and relative paths are not packages.
function importedPackages(src) {
  const specs = new Set();
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const re = /(?:^\s*(?:import|export)\b[^'"]*?\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    const spec = m[2];
    if (spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) continue;
    specs.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
  return [...specs];
}

test('release.yml and dependabot-merge.yml follow the CI workflow by its exact name', () => {
  // workflow_run matches on the triggering workflow's `name:`. Rename the CI
  // workflow without these two and releases stop being tagged AND Dependabot
  // PRs stop being merged, with no error anywhere: a workflow_run naming a
  // workflow that does not exist is simply never triggered.
  const ci = topLevelName(workflow('test.yml'), 'test.yml');
  for (const file of ['release.yml', 'dependabot-merge.yml']) {
    assert.deepEqual(workflowRunTargets(workflow(file), file), [ci], `${file} must follow "${ci}"`);
  }
});

test("the Monday bump's check-command runs exactly the checks test.yml runs", () => {
  // The bump's merge is a GITHUB_TOKEN push, which fires no workflows, so
  // check-command is the ONLY validation a bump gets before it lands on main.
  // It omitted `npm run lint` while its own comment said "the same checks
  // test.yml runs", so a bump that reddened lint would have merged green.
  assert.deepEqual(
    blockScalar(workflow('kit-pin-bump.yml'), 'check-command', 'kit-pin-bump.yml'),
    blockScalar(workflow('test.yml'), 'run', 'test.yml'),
  );
});

test('the shipped files only reach packages a consumer actually installs', () => {
  // bin/vendor.mjs is a shim that runs whatever @jfs/vendor-cli resolves from
  // INSIDE this package. A consumer installing news-kit gets its
  // `dependencies` and never its `devDependencies`, so a package the shim
  // imports that sits only in devDependencies is a shim with nothing to load —
  // or, worse, one that silently resolves whatever vendor-cli sits at the top
  // of the CONSUMER's tree. index.js is the dependency-free half: it is
  // vendored as a single file, so any import in it is a dangling specifier in
  // every consumer's copy.
  const shipped = pkg.files;
  assert.ok(Array.isArray(shipped) && shipped.includes('index.js') && shipped.includes('bin'),
    'package.json `files` must ship index.js and bin');

  assert.deepEqual(importedPackages(read('index.js')), [], 'index.js must import nothing');

  const bins = readdirSync(new URL('../bin/', import.meta.url)).filter((f) => /\.(mjs|js|cjs)$/.test(f));
  assert.ok(bins.length > 0, 'no bin/ modules found');
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  let seen = 0;
  for (const f of bins) {
    for (const name of importedPackages(read(`bin/${f}`))) {
      seen++;
      assert.ok(name in deps, `bin/${f} imports ${name}, which is not in package.json dependencies`);
      assert.ok(!(name in devDeps), `${name} is in devDependencies too — keep it in dependencies only`);
    }
  }
  assert.ok(seen > 0, 'bin/ imports no package at all — the shim no longer reaches @jfs/vendor-cli?');
  assert.ok('@jfs/vendor-cli' in deps, '@jfs/vendor-cli must be a dependencies entry');
});

test('meta: the parsers see what they claim to see', () => {
  // A parser that returned nothing would make every assertion above vacuous.
  assert.deepEqual(importedPackages("import { a } from '@x/y/sub';\nimport 'z';\nexport { b } from \"w/q\";\nconst c = await import('v');\n// import { d } from 'commented';\nimport { e } from 'node:fs';\nimport f from './rel.js';"),
    ['@x/y', 'z', 'w', 'v']);
  assert.deepEqual(blockScalar('with:\n  run: |\n    one\n    # note\n\n    two\n  next: x\n', 'run', 't'), ['one', 'two']);
  assert.deepEqual(workflowRunTargets("on:\n  workflow_run:\n    workflows: ['Test', CI]  # note\n", 't'), ['Test', 'CI']);
  assert.equal(topLevelName('# header\nname: "Test"   # the CI workflow\non: push\n', 't'), 'Test');
  assert.throws(() => blockScalar('run: x\n', 'run', 't'));
  assert.throws(() => workflowRunTargets('on: push\n', 't'));
});
