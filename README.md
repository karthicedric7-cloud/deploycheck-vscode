# deploycheck

> Catch what breaks production before it breaks.

Real time environment validation inside VS Code. deploycheck runs 7 checks on your environment before you push to production.

Works with Node.js, Next.js, Vite, and Create React App. Automatically detects your project type.

## Commands

Open the Command Palette with Ctrl+Shift+P and run:

**deploycheck: Generate env.manifest.json**
Scans your entire project for environment variables and automatically generates env.manifest.json.

Works with:
- process.env for Node.js and Next.js projects
- import.meta.env for Vite projects
- REACT_APP_ variables for Create React App

**deploycheck: Validate Environment**
Runs 7 checks on your environment and tells you exactly what will break before you push.

## What deploycheck checks

1. Missing required environment variables
2. Empty required environment variables
3. Runtime version mismatch (Node version)
4. Duplicate variables in .env
5. Dependencies not installed
6. Dependency drift (in package.json but not installed)
7. Variables in .env.example but missing from .env

## Supported project types

deploycheck automatically detects your project type.

- Node.js       scans process.env
- Next.js       scans process.env
- Vite          scans import.meta.env
- React CRA     scans REACT_APP_ variables

## How it works

Step 1: Open your project in VS Code
Step 2: Press Ctrl+Shift+P
Step 3: Type deploycheck
Step 4: Run Generate to create your manifest
Step 5: Run Validate before every push

## CLI Version

For terminal and CI use install the CLI:

npm install -g safelaunch

safelaunch init
safelaunch validate

## Built by Orches

JavaScript Reliability Infrastructure.
GitHub: https://github.com/karthicedric7-cloud/safelaunch
npm: https://www.npmjs.com/package/safelaunch