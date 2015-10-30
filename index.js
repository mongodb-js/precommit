/* eslint no-console:0 */
var format = require('util').format;
var dc = require('dependency-check');
var glob = require('glob');
var defaults = require('lodash.defaults');
var unique = require('lodash.uniq');
var CLIEngine = require('eslint').CLIEngine;
var async = require('async');
var path = require('path');
var chalk = require('chalk');
var figures = require('figures');
var assign = require('lodash.assign');
var debug = require('debug')('mongodb-js-precommit');

/**
 * Expand globs into paths.
 */
function resolve(opts, done) {
  debug('resolving paths for globs:\n', JSON.stringify(opts.globs));
  var tasks = opts.globs.map(function(pattern) {
    return function(cb) {
      debug('resolving `%s`...', pattern);
      glob(pattern, {}, function(err, files) {
        if (err) {
          return cb(err);
        }
        debug('resolved %d file(s) for `%s`', files.length, pattern);
        if (files.length > 0) {
          opts.files.push.apply(opts.files, files);
        }
        cb();
      });
    };
  });
  async.parallel(tasks, function(err) {
    if (err) {
      return done(err);
    }
    debug('checking and removing duplicate paths...');
    opts.files = unique(opts.files);
    debug('final result has `%d` files', opts.files.length);
    done(null, opts.files);
  });
}


function check(options, mode, done) {
  if (mode === 'extra') {
    console.log('  ' + chalk.gray(figures.pointerSmall,
        'Checking for dependencies in package.json not used in code'
        + figures.ellipsis));
  } else {
    console.log('  ' + chalk.gray(figures.pointerSmall,
        'Checking for dependencies used in code but not added to package.json'
        + figures.ellipsis));
  }

  var pkg = require(path.join(options.dir, 'package.json'));
  defaults(pkg['dependency-check'], {
    entries: [],
    ignore: []
  });
  pkg.devDependencies = pkg.devDependencies || {};

  var opts = {
    path: path.join(options.dir, 'package.json'),
    entries: pkg['dependency-check'].entries,
    ignore: pkg['dependency-check'].ignore
  };
  opts.ignore = opts.ignore || [];
  opts.entries = opts.entries || [];

  /**
   * Sane defaults for common devDependencies not used via an `entry` script.
   */
  opts.ignore.push.apply(opts.ignore, [
    'eslint-config-mongodb-js',
    'mongodb-js-precommit'
  ]);

  var test = pkg.scripts.test;
  /**
   * If mocha already a dependency and we're using it for `test`,
   * ignore it so it doesn't show up as an extra dependency.
   */
  if (test && test.indexOf('mocha') > -1 && pkg.devDependencies.mocha) {
    opts.ignore.push('mocha');
  }

  function filterIgnored(results) {
    return results.filter(function(name) {
      return opts.ignore.indexOf(name) === -1;
    });
  }

  dc(opts, function(err, data) {
    if (err) {
      return done(err);
    }
    pkg = data.package;

    var deps = data.used;
    var results;
    var errMsg;
    var corrector;

    if (mode === 'extra') {
      // Are all dependencies in package.json are used in the code?
      results = filterIgnored(dc.extra(pkg, deps, {
        excludeDev: true
      }));
      errMsg = 'Modules in package.json not used in code';
      corrector = 'npm uninstall --save ' + results.join(' ') + ';';
    } else {
      // Are we missing any dependencies in package.json?
      results = filterIgnored(dc.missing(pkg, deps));
      errMsg = 'Dependencies not listed in package.json';
      corrector = 'npm install --save ' + results.join(' ') + ';';
    }

    if (results.length === 0) {
      if (mode === 'extra') {
        console.log('  ' + chalk.green(figures.tick),
          ' No extra dependencies in package.json');
      } else {
        console.log('  ' + chalk.green(figures.tick),
          ' All dependencies declared in package.json');
      }
      return done();
    }
    errMsg += '\n' + corrector;
    errMsg += '\nPlease see the configuration docs for more info:\n';
    errMsg += 'https://github.com/mongodb-js/precommit#configuration';

    options.result.errors.push(new Error(errMsg));
    return done();
  });
}

var lint = function(opts, done) {
  var cli = new CLIEngine({
    useEslintrc: true
  });

  /**
   * @todo (imlucas): See `mongodb-js-fmt` --changed option.
   * Should use the solution for that here as well by default
   * bc we're a precommit hook and should only be looking
   * at the files the user actually changed.
   */
  debug('linting files', opts.files);
  console.log('  ' + chalk.gray(figures.pointerSmall,
      format('Running eslint on %d files%s', opts.files.length,
        figures.ellipsis)));

  var report = cli.executeOnFiles(opts.files);
  var formatter = cli.getFormatter();
  if (!opts.json) {
    opts.result.eslint = formatter(report.results);
  } else {
    opts.result.eslint = report.results;
  }

  debug('eslint result', JSON.stringify(report.results, null, 2));
  if (report.errorCount > 0) {
    console.log(opts.result.eslint);
    var err = new Error(format(
      'Please fix the %d error(s) above and try again.',
      report.errorCount));
    opts.result.errors.push(err);
  } else {
    console.log('  ' + chalk.green(figures.tick),
      ' No errors found by eslint');
  }
  done();
};

module.exports = function(opts, done) {
  defaults(opts, {
    dir: process.cwd(),
    files: [],
    dry: false,
    json: false,
    formatted: [],
    unchanged: [],
    result: {
      errors: []
    }
  });

  if (opts.globs.length === 0) {
    // @todo (imlucas): yeah, I can never remember how
    // to properly exclude node_modules either...
    opts.globs = [
      './bin/*.js',
      './lib/{**/*,*}.js',
      './examples/{**/*,*}.js',
      './src/{**/*,*}.js',
      './test/{**/*,*}.js',
      './*.js'
    ];
  }

  if (!Array.isArray(opts.globs)) {
    opts.globs = [opts.globs];
  }

  console.log(chalk.gray(
    'Checking for potential errors' + figures.ellipsis));
  console.log(chalk.gray('Use the'),
    chalk.gray.bold('--debug'),
    chalk.gray('flag to print diagnostic info')
  );

  console.log(chalk.gray('For more info, please see'),
    chalk.gray.bold('https://github.com/mongodb-js/precommit'), '\n');

  async.series([
    resolve.bind(null, opts),
    check.bind(null, opts, 'missing'),
    check.bind(null, opts, 'extra'),
    lint.bind(null, opts)
  ], function(err) {
    if (err) {
      return done(err);
    }
    if (opts.result.errors.length > 0) {
      var error = new Error(format('%d check(s) failed', opts.result.errors.length));
      assign(error, opts);
      return done(error);
    }
    return done(null, opts);
  });
};
