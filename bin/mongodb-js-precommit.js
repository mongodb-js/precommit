#!/usr/bin/env node

/* eslint no-sync:0, no-console:0 */
var chalk = require('chalk');
var figures = require('figures');

var args = require('minimist')(process.argv.slice(2), {
  boolean: ['debug', 'json'],
  string: ['detective']
});

var usage = `Usage: mongodb-js-precommit <file>... [--dir=<path/to/module/dir>]

I'll help you keep typos out of your projects.

Usage:
  # Lint all js files in the \`./lib\` directory:
  mongodb-js-precommit ./lib/{*.js,**/*.js}

Options:
  <file>
  --dir=<path>   The directory your package.json lives in. [Default: \`process.cwd()]\`].
  --json         Ooutput as JSON for your machine friends [Default: \`false\`].
  --debug        Enable debug messages.
  -h --help      Show this screen.
  --version      Show version.
  --detective    Use a different parser for the \`dependency-check\`. [Default: \`precinct\`].
`;

if (args.debug) {
  process.env.DEBUG = 'mongodb-js-precommit';
}
var precommit = require('../');
var pkg = require('../package.json');

args.globs = args._;

if (args.help || args.h) {
  console.error(usage);
  process.exit(1);
}
if (args.version) {
  console.error(pkg.version);
  process.exit(1);
}

function hr(inputHrStr) {
  var width = (process.stdout.isTTY) ? process.stdout.getWindowSize()[0] : 0;
  var hrStr = inputHrStr.length > 0 ? inputHrStr : '=';
  var out = (Array(Math.floor(width / hrStr.length) + 1).join(hrStr));

  var partialLen = (width - (Math.floor(width / hrStr.length)) * hrStr.length);
  out += hrStr.substring(0, partialLen);
  console.log(chalk.gray(out));
}


precommit(args, function(err, res) {
  if (!args.json) {
    hr(figures.line);
  }

  if (err) {
    if (args.json) {
      err = JSON.stringify(err, null, 2);
    } else {
      console.error(chalk.red(figures.cross), err.message);
      if (!err.result) {
        console.error(chalk.gray(err.stack));
      }
    }
    process.exit(1);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(chalk.green(' ', figures.tick), ' OK!  0 potential errors found');

    if (res.result.warnings.length > 0) {
      console.log('\n', chalk.yellow(' ', figures.warning),
        ' ' + res.result.warnings.length + ' check(s) produced warnings you should be aware of:\n');

      res.result.warnings.map(function(warning) {
        console.log(' ' + chalk.yellow.bold(' ', figures.warning), ' ' + warning.title + '\n');
        warning.message.split('\n').forEach(function(line) {
          console.log('  ' + line);
        });
      });
    }
  }
});
