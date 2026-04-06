#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

// Bump patch version: 2.9.0 -> 2.9.1
const versionParts = packageJson.version.split('.');
const patch = parseInt(versionParts[2], 10) + 1;
const newVersion = `${versionParts[0]}.${versionParts[1]}.${patch}`;

packageJson.version = newVersion;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');

console.log(`✓ Version bumped: ${packageJson.version}`);
