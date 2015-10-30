#!/usr/bin/env node

/* eslint no-sync:0, no-console:0 */
var path = require('path');
var fs = require('fs');
var chalk = require('chalk');
var figures = require('figures');

var usage = fs.readFileSync(path.resolve(__dirname, '../usage.txt')).toString();
var args = require('minimist')(process.argv.slice(2), {
  boolean: ['debug', 'json']
});

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

precommit(args, function(err, res) {
  if (err) {
    if (args.json) {
      err = JSON.stringify(err, null, 2);
    }
    console.error(chalk.red(figures.cross), err.message);
    console.error(chalk.gray(err.stack));
    process.exit(1);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log('\n\n', chalk.green(figures.tick), ' OK!  No potential errors found');
  }
});
