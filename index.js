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
 *
 * @param {Object} opts
 * @param {Function} done
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
  } else if (mode === 'extra-dev') {
    console.log('  ' + chalk.gray(figures.pointerSmall,
        'Checking for devDependencies in package.json not used in code'
        + figures.ellipsis));
  } else {
    console.log('  ' + chalk.gray(figures.pointerSmall,
        'Checking for dependencies used in code but not added to package.json'
        + figures.ellipsis));
  }

  var pkg = require(path.join(options.dir, 'package.json'));
  defaults(pkg, {
    'dependency-check': {
      entries: [],
      ignore: []
    },
    devDependencies: {}
  });

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
    'mongodb-js-precommit',
    'mongodb-js-fmt',
    'pre-commit'
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
      })).filter(function(name) {
        return pkg.devDependencies[name] !== undefined;
      });

      errMsg = results.length + ' dependencies in package.json are not used in code';
      corrector = 'npm uninstall --save ' + results.join(' ') + ';';
    } else if (mode === 'extra-dev') {
      results = filterIgnored(dc.extra(pkg, deps, {
        excludeDev: false
      })).filter(function(name) {
        return pkg.devDependencies[name] !== undefined;
      });

      errMsg = results.length + ' devDependencies in package.json could not be detected as used in code';
      corrector = 'npm uninstall --save-dev ' + results.join(' ') + ';';
    } else {
      // Are we missing any dependencies in package.json?
      results = filterIgnored(dc.missing(pkg, deps));
      errMsg = results.length + ' dependencies|devDependencies missing from package.json';
      corrector = results.map(function(name) {
        return 'npm install --save ' + name + ';';
      }).join('\n');
    }

    if (results.length === 0) {
      if (mode === 'extra') {
        console.log('  ' + chalk.green(figures.tick),
          ' No extra dependencies in package.json');
      } else if (mode === 'extra-dev') {
        console.log('  ' + chalk.green(figures.tick),
          ' No extra devDependencies in package.json');
      } else {
        console.log('  ' + chalk.green(figures.tick),
          ' No missing dependencies in package.json');
      }
      return done();
    }

    if (mode === 'extra-dev') {
      var msg = [
        chalk.gray('  There are modules listed as devDependencies in package.json we\n'),
        chalk.gray('  could not detect are being used in your code.\n\n'),
        chalk.gray('  Advanced users should considering updating the `dependency-check`\n'),
        chalk.gray('  configuration in package.json to add additional entrypoints to scan for usage.\n'),
        chalk.gray('  We suggest running the following command to clean-up:\n'),
        chalk.white.bold('    npm install --save ' + results.join(' ') + ';\n\n'),
        chalk.gray('\n\nPlease see the configuration docs for more info:\n'),
        chalk.blue('https://github.com/mongodb-js/precommit#configuration')
      ].join('');

      var title = format('%d potentially unused devDependencies', results.length);
      options.result.warnings.push({
        title: title,
        message: msg
      });

      console.log('  ' + chalk.yellow(figures.warning), ' ' + title);
      return done();
    }

    console.log('  ' + chalk.red(figures.cross), ' ' + errMsg);

    errMsg += chalk.gray('\nYou can correct this error by running:');
    errMsg += '\n    ' + chalk.bold.white(corrector);
    errMsg += chalk.gray('\n\nPlease see the configuration docs for more info:\n');
    errMsg += chalk.blue('https://github.com/mongodb-js/precommit#configuration');

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
    var msg = format(
      'Please fix the %d error(s) below.',
      report.errorCount);
    msg += '\n\n' + formatter(report.results);
    var err = new Error(msg);
    opts.result.errors.push(err);
    console.log('  ' + chalk.red.bold(figures.cross),
      report.errorCount, ' eslint errors detected');
  } else if (report.warningCount > 0) {
    var title = format('%s eslint warnings detected', report.warningCount);
    console.log('  ' + chalk.yellow.bold(figures.warning), ' ' + title);

    opts.result.warnings.push({
      title: title,
      message: [
        chalk.gray(format('  While eslint detected 0 potential errors,'
          + ' you may want to consider addressing these %s warnings:', report.warningCount))
        + '\n\n',
        formatter(report.results)
      ].join('')
    });
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
      errors: [],
      warnings: []
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

  var checks = [
    check.bind(null, opts, 'missing'),
    check.bind(null, opts, 'extra'),
    // check.bind(null, opts, 'extra-dev'),
    lint.bind(null, opts)
  ];

  var tasks = [
    resolve.bind(null, opts)
  ];
  tasks.push.apply(tasks, checks);

  async.series(tasks, function(err) {
    if (err) {
      return done(err);
    }

    if (opts.result.errors.length > 0) {
      var error = new Error(format('%d of %d check(s) failed:\n',
        opts.result.errors.length, checks.length));

      opts.result.errors.map(function(e) {
        e.message.split('\n').map(function(line, i) {
          if (i === 0) {
            error.message += '  ' + chalk.red.bold(line) + '\n';
          } else {
            error.message += '      ' + line + '\n';
          }
        });
      });
      assign(error, opts);
      return done(error);
    }
    return done(null, opts);
  });
};
