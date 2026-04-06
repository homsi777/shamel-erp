#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const warnOnly = args.includes('--warn-only');
const reportArgIndex = args.findIndex((arg) => arg === '--report');
const customReportPath = reportArgIndex >= 0 ? args[reportArgIndex + 1] : '';
const reportPath = customReportPath || path.join('reports', 'arabic-corruption-report.txt');

const scanRoots = ['src', 'backend', 'electron', 'scripts', 'data'];
const scanRootFiles = ['package.json', 'index.html', 'App.tsx', 'index.tsx', 'README.md'];
const allowedExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md', '.cjs', '.mjs', '.html', '.txt']);
const ignoreDirNames = new Set(['node_modules', '.git', 'dist', 'dist-server', 'dist-electron', 'android']);

// Common mojibake markers for Arabic text interpreted with the wrong encoding.
const mojibakePattern = /(?:\u0637[\u00A0-\u00FF]|\u0638[\u00A0-\u00FF]|[\u00D8\u00D9\u00C3][\u0080-\u00FF\u2018-\u203A]|\u00E2[\u0080-\u00FF\u2018-\u203A]|\u00EF[\u0080-\u00FF\u2018-\u203A])/;
const hasArabicPattern = /[\u0600-\u06FF]/;
const noisyPattern = /(?:\u0637[\u00A0-\u00FF]|\u0638[\u00A0-\u00FF]|[\u00D8\u00D9\u00C3][\u0080-\u00FF\u2018-\u203A]|\u00E2[\u0080-\u00FF\u2018-\u203A]|\u00EF[\u0080-\u00FF\u2018-\u203A]|\uFFFD)/g;

function badScore(text) {
  return (text.match(noisyPattern) || []).length;
}

function tryRepairLine(line) {
  if (!mojibakePattern.test(line)) return null;
  const converted = iconv.decode(iconv.encode(line, 'win1256'), 'utf8');
  if (converted === line) return null;
  if (!hasArabicPattern.test(converted)) return null;
  if (badScore(converted) >= badScore(line)) return null;
  return converted;
}

function collectFiles() {
  const files = [];

  function walk(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirNames.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExt.has(ext)) continue;
      files.push(fullPath);
    }
  }

  for (const root of scanRoots) walk(root);
  for (const file of scanRootFiles) {
    if (fs.existsSync(file)) files.push(file);
  }

  return Array.from(new Set(files));
}

function trimSnippet(text, max = 180) {
  const oneLine = text.replace(/\t/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + '…';
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function scanFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const lines = original.split(/\r?\n/);

  const findings = [];
  const unresolved = [];
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    if (!mojibakePattern.test(current)) continue;

    const repaired = tryRepairLine(current);
    if (repaired) {
      findings.push({
        filePath,
        line: i + 1,
        before: current,
        after: repaired,
      });
      if (shouldFix) {
        lines[i] = repaired;
        changed = true;
      }
    } else {
      unresolved.push({
        filePath,
        line: i + 1,
        text: current,
      });
    }
  }

  if (shouldFix && changed) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  }

  return { findings, unresolved, changed };
}

function buildReport(scanResults, totalFiles) {
  const findings = scanResults.flatMap((r) => r.findings);
  const unresolved = scanResults.flatMap((r) => r.unresolved);
  const changedFiles = scanResults.filter((r) => r.changed).map((r) => r.filePath);

  const out = [];
  out.push('Arabic Corruption Scan Report');
  out.push(`Generated At: ${new Date().toISOString()}`);
  out.push(`Mode: ${shouldFix ? 'fix' : 'scan'}`);
  out.push(`Warn Only: ${warnOnly ? 'yes' : 'no'}`);
  out.push(`Scanned Files: ${totalFiles}`);
  out.push(`Convertible Findings: ${findings.length}`);
  out.push(`Unresolved Suspects: ${unresolved.length}`);
  out.push(`Changed Files: ${changedFiles.length}`);
  out.push('');

  if (changedFiles.length > 0) {
    out.push('Changed Files:');
    for (const file of changedFiles) out.push(`- ${file}`);
    out.push('');
  }

  if (findings.length > 0) {
    out.push('Convertible Findings:');
    for (const finding of findings) {
      out.push(`[${finding.filePath}:${finding.line}]`);
      out.push(`  Before: ${trimSnippet(finding.before)}`);
      out.push(`  After : ${trimSnippet(finding.after)}`);
    }
    out.push('');
  }

  if (unresolved.length > 0) {
    out.push('Unresolved Suspects (manual review required):');
    for (const item of unresolved) {
      out.push(`[${item.filePath}:${item.line}] ${trimSnippet(item.text)}`);
    }
    out.push('');
  }

  if (findings.length === 0 && unresolved.length === 0) {
    out.push('No Arabic mojibake indicators found.');
  }

  return out.join('\n');
}

function main() {
  const files = collectFiles();
  const results = files.map((filePath) => scanFile(filePath));

  const report = buildReport(results, files.length);
  ensureParentDir(reportPath);
  fs.writeFileSync(reportPath, report, 'utf8');

  const findingsCount = results.reduce((sum, item) => sum + item.findings.length, 0);
  const unresolvedCount = results.reduce((sum, item) => sum + item.unresolved.length, 0);
  const changedCount = results.reduce((sum, item) => sum + (item.changed ? 1 : 0), 0);

  console.log(`[scan:arabic] Scanned ${files.length} files.`);
  console.log(`[scan:arabic] Convertible findings: ${findingsCount}.`);
  console.log(`[scan:arabic] Unresolved suspects: ${unresolvedCount}.`);
  if (shouldFix) console.log(`[scan:arabic] Changed files: ${changedCount}.`);
  console.log(`[scan:arabic] Report: ${reportPath}`);

  if (shouldFix) {
    if (unresolvedCount > 0) process.exitCode = 1;
    return;
  }

  if (warnOnly) {
    return;
  }

  if (findingsCount > 0 || unresolvedCount > 0) process.exitCode = 1;
}

main();
