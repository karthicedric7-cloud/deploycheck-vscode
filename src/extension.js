const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { PostHog } = require('posthog-node');

const phClient = new PostHog('phc_WFm3O5H7wkZK2Ne3kyy5QgUXJR8y86SQbszSwk3BUn0', {
  host: 'https://us.i.posthog.com'
});

function track(event, properties = {}) {
  phClient.capture({
    distinctId: 'anonymous',
    event,
    properties: {
      ...properties,
      extension_version: '0.0.12'
    }
  });
}

function detectProjectType(cwd) {
  if (fs.existsSync(path.join(cwd, 'vite.config.js')) ||
      fs.existsSync(path.join(cwd, 'vite.config.ts'))) {
    return 'vite';
  }
  if (fs.existsSync(path.join(cwd, 'next.config.js')) ||
      fs.existsSync(path.join(cwd, 'next.config.ts'))) {
    return 'next';
  }
  const packagePath = path.join(cwd, 'package.json');
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    if (deps['react-scripts']) return 'cra';
  }
  return 'node';
}

function scanFiles(dir, extensions, pattern, found = new Set()) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item === 'node_modules' || item === '.git') continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanFiles(full, extensions, pattern, found);
    } else if (extensions.some(ext => item.endsWith(ext))) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.matchAll(pattern);
      for (const match of matches) found.add(match[1]);
    }
  }
  return found;
}

function checkPrefixes(envVars, projectType) {
  const warnings = [];
  for (const key of Object.keys(envVars)) {
    if (key === 'NODE_ENV') continue;
    if (projectType === 'vite' && !key.startsWith('VITE_')) {
      warnings.push(key + ' missing VITE_ prefix (won\'t be exposed to client)');
    }
    if (projectType === 'cra' && !key.startsWith('REACT_APP_')) {
      warnings.push(key + ' missing REACT_APP_ prefix (won\'t be exposed to client)');
    }
  }
  return warnings;
}

function checkEnvPriority(cwd, projectType) {
  if (projectType !== 'next') return [];
  const warnings = [];
  const fileVars = {};
  const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
  for (const file of envFiles) {
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) continue;
    const vars = {};
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
    fileVars[file] = vars;
  }
  if (fileVars['.env'] && fileVars['.env.local']) {
    for (const key of Object.keys(fileVars['.env'])) {
      if (fileVars['.env.local'][key]) {
        warnings.push(key + ' defined in both .env and .env.local (.env.local takes priority)');
      }
    }
  }
  return warnings;
}

function activate(context) {
  const initCommand = vscode.commands.registerCommand('deploycheck.init', function () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('deploycheck: No workspace folder open.');
      return;
    }
    const cwd = workspaceFolders[0].uri.fsPath;
    const manifestPath = path.join(cwd, 'env.manifest.json');

    if (fs.existsSync(manifestPath)) {
      vscode.window.showWarningMessage('deploycheck: env.manifest.json already exists. Delete it first to regenerate.');
      track('deploycheck_init_already_exists');
      return;
    }

    const projectType = detectProjectType(cwd);
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
    const typeLabels = { vite: 'Vite', next: 'Next.js', cra: 'Create React App', node: 'Node.js' };

    let pattern;
    if (projectType === 'vite') {
      pattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
    } else if (projectType === 'cra') {
      pattern = /process\.env\.(REACT_APP_[A-Z0-9_]*)/g;
    } else {
      pattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
    }

    const found = scanFiles(cwd, extensions, pattern);

    if (found.size === 0) {
      vscode.window.showInformationMessage('deploycheck: No environment variables found in your ' + typeLabels[projectType] + ' project.');
      track('deploycheck_init_run', { project_type: projectType, vars_found: 0 });
      return;
    }

    const variables = {};
    for (const key of [...found].sort()) {
      variables[key] = { required: true, description: '' };
    }

    const manifest = {
      version: '1',
      projectType: projectType,
      runtime: { node: process.version.replace('v', '').split('.')[0] },
      variables
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    track('deploycheck_init_run', { project_type: projectType, vars_found: found.size });
    vscode.window.showInformationMessage('deploycheck: Found ' + found.size + ' variables in ' + typeLabels[projectType] + ' project. Created env.manifest.json');

    vscode.workspace.openTextDocument(manifestPath).then(doc => {
      vscode.window.showTextDocument(doc);
    });
  });

  const validateCommand = vscode.commands.registerCommand('deploycheck.validate', function () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('deploycheck: No workspace folder open.');
      return;
    }
    const cwd = workspaceFolders[0].uri.fsPath;
    const manifestPath = path.join(cwd, 'env.manifest.json');

    if (!fs.existsSync(manifestPath)) {
      vscode.window.showWarningMessage('deploycheck: No env.manifest.json found. Run deploycheck.init first.');
      return;
    }

    const envPath = path.join(cwd, '.env');
    if (!fs.existsSync(envPath)) {
      vscode.window.showErrorMessage('deploycheck: No .env file found.');
      return;
    }

    const envVars = {};
    const duplicates = [];
    const seen = new Set();
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
        envVars[key] = match[2].trim();
      }
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const projectType = manifest.projectType || detectProjectType(cwd);
    const typeLabels = { vite: 'Vite', next: 'Next.js', cra: 'Create React App', node: 'Node.js' };

    const missing = [];
    const empty = [];

    for (const [key, val] of Object.entries(manifest.variables || {})) {
      if (val.required && key in envVars && envVars[key] === '') {
        empty.push(key);
      } else if (val.required && !(key in envVars)) {
        missing.push(key);
      }
    }

    const examplePath = path.join(cwd, '.env.example');
    const exampleMissing = [];
    if (fs.existsSync(examplePath)) {
      const exLines = fs.readFileSync(examplePath, 'utf8').split('\n');
      for (const line of exLines) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && !envVars[match[1].trim()]) exampleMissing.push(match[1].trim());
      }
    }

    const nodeRequired = manifest.runtime && manifest.runtime.node ? String(manifest.runtime.node) : null;
    const nodeActual = process.version.replace('v', '').split('.')[0];
    const runtimeMismatch = nodeRequired && nodeRequired !== nodeActual;

    const modulesPath = path.join(cwd, 'node_modules');
    const packagePath = path.join(cwd, 'package.json');
    let driftMissing = [];
    let notInstalled = false;
    if (fs.existsSync(packagePath)) {
      if (!fs.existsSync(modulesPath)) {
        notInstalled = true;
      } else {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {});
        driftMissing = deps.filter(dep => !fs.existsSync(path.join(modulesPath, dep)));
      }
    }

    const prefixWarnings = checkPrefixes(envVars, projectType);
    const priorityWarnings = checkEnvPriority(cwd, projectType);

    const problems = [];
    if (runtimeMismatch) problems.push('Runtime mismatch: need Node ' + nodeRequired + ' got ' + nodeActual);
    if (duplicates.length > 0) problems.push('Duplicates: ' + duplicates.join(', '));
    if (notInstalled) problems.push('node_modules missing. Run npm install.');
    if (driftMissing.length > 0) problems.push('Drift: ' + driftMissing.join(', '));
    if (exampleMissing.length > 0) problems.push('Missing from .env.example: ' + exampleMissing.join(', '));
    if (prefixWarnings.length > 0) problems.push('Prefix warnings: ' + prefixWarnings.join(' | '));
    if (priorityWarnings.length > 0) problems.push('Env priority: ' + priorityWarnings.join(' | '));
    if (empty.length > 0) problems.push('Empty: ' + empty.join(', '));
    if (missing.length > 0) problems.push('Missing: ' + missing.join(', '));

    const label = typeLabels[projectType] || 'Node.js';
    const passed = problems.length === 0;

    track('deploycheck_validate_run', {
      project_type: projectType,
      passed,
      issues: problems.length,
      prefix_warnings: prefixWarnings.length,
      priority_warnings: priorityWarnings.length,
      missing: missing.length,
      empty: empty.length,
      duplicates: duplicates.length
    });

    if (passed) {
      vscode.window.showInformationMessage('deploycheck (' + label + '): ✅ Environment is ready for production.');
    } else {
      vscode.window.showErrorMessage('deploycheck (' + label + '): ❌ ' + problems[0]);
      if (problems.length > 1) {
        vscode.window.showWarningMessage('deploycheck: ' + (problems.length - 1) + ' more issue(s): ' + problems.slice(1).join(' | '));
      }
    }
  });

  context.subscriptions.push(initCommand);
  context.subscriptions.push(validateCommand);
}

function deactivate() {
  phClient.shutdown();
}

module.exports = { activate, deactivate };