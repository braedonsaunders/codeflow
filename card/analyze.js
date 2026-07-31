#!/usr/bin/env node

'use strict';

const path = require('path');

const { analyze } = require('./lib/analysis.js');

function usage() {
  return [
    'Usage: node card/analyze.js [--path <directory>] [--exclude <glob> ...]',
    '',
    'Writes a versioned CodeFlow analysis envelope to stdout as JSON.',
    'Repeat --exclude to omit multiple files or directory patterns.',
  ].join('\n');
}

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(flag + ' requires a value');
  return argv[index + 1];
}

function parseArgs(argv) {
  const parsed = { repoRoot: process.cwd(), exclude: [], help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--path') {
      parsed.repoRoot = readValue(argv, index, '--path');
      index++;
    } else if (arg.startsWith('--path=')) {
      parsed.repoRoot = arg.slice('--path='.length);
    } else if (arg === '--exclude') {
      parsed.exclude.push(readValue(argv, index, '--exclude'));
      index++;
    } else if (arg.startsWith('--exclude=')) {
      parsed.exclude.push(arg.slice('--exclude='.length));
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  parsed.repoRoot = path.resolve(parsed.repoRoot);
  return parsed;
}

async function main(argv) {
  const parsed = parseArgs(argv || process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage() + '\n');
    return;
  }
  const result = await analyze({ repoRoot: parsed.repoRoot, exclude: parsed.exclude });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write('[codeflow-analyze] error: ' + (error.stack || error.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { analyze, main, parseArgs, usage };
