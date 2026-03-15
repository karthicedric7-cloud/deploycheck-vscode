const fs = require('fs');
const path = require('path');

function scanFiles(dir, extensions, found = new Set()) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item === 'node_modules' || item === '.git') continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanFiles(full, extensions, found);
    } else if (extensions.some(ext => item.endsWith(ext))) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const match of matches) {
        found.add(match[1]);
      }
    }
  }
  return found;
}

function init() {
  console.log('\nscanning project for environment variables...\n');
  const cwd = process.cwd();
  const extensions = ['.js', '.ts', '.jsx', '.tsx'];
  const found = scanFiles(cwd, extensions);
  if (found.size === 0) {
    console.log('no process.env references found.\n');
    return;
  }
  const variables = {};
  for (const key of [...found].sort()) {
    variables[key] = { required: true, description: '' };
  }
  const manifest = {
    version: '1',
    runtime: { node: process.version.replace('v', '').split('.')[0] },
    variables
  };
  const manifestPath = path.join(cwd, 'env.manifest.json');
  if (fs.existsSync(manifestPath)) {
    console.log('env.manifest.json already exists. delete it first.\n');
    return;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('found ' + found.size + ' environment variables:\n');
  for (const key of [...found].sort()) {
    console.log('  ' + key);
  }
  console.log('\ncreated env.manifest.json\n');
}

init();