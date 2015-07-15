var dc = require('dependency-check');
var format = require('util').format;
var debug = require('debug')('mongodb-js-precommit');
var glob = require('glob');
var CLIEngine = require('eslint').CLIEngine;
var jsfmt = require('jsfmt');
var async = require('async');
var fs = require('fs');

function check(options, mode, done) {
  var pkg = require(process.cwd() + '/package.json');
  pkg['dependency-check'] = pkg['dependency-check'] || {
      entries: [],
      ignore: []
    };
  pkg.devDependencies = pkg.devDependencies || {};

  var opts = {
    path: process.cwd() + '/package.json',
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
    if (err) return done(err);
    var pkg = data.package;
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
      return done();
    }
    console.error('Error: ' + errMsg + '. To fix this, run:\n\n    ' + corrector + '\n');
    options.result.errors.push(new Error(errMsg));
    return done();
  });
}

var lint = function(opts, done) {
  var cli = new CLIEngine({
    useEslintrc: true
  });

  debug('Getting paths to lint...');
  debug('Linting files', opts.files);
  var report = cli.executeOnFiles(opts.files);
  var formatter = cli.getFormatter();
  console.log(formatter(report.results));

  if (report.errorCount > 0) {
    var err = new Error(format(
      'Please fix the %d error(s) above and try again.', report.errorCount));
    opts.result.errors.push(err);
    return done();
  }
  done();
};

var fmt = function(opts, done) {
  var config = jsfmt.getConfig();

  function fmt(src, cb) {
    fs.readFile(src, function(err, buf) {
      if (err) return cb(err);
      try {
        var formatted = jsfmt.format(buf.toString('utf-8'), config);
        fs.writeFile(src, formatted, cb);
      } catch (e) {
        return cb(e);
      }
    });
  }
  async.parallel(opts.files.map(function(file) {
    return fmt.bind(null, file);
  }), function(err) {
    if (err) {
      opts.result.errors.push(err);
    }
    done();
  });
};

module.exports = function(done) {
  var pkg = require(process.cwd() + '/package.json');
  var opts = {
    ignore: [
      'node_modules/**'
    ]
  };
  pkg.check = pkg.check || {};
  pkg.check.ignore = pkg.check.ignore || [];

  opts.ignore.push.apply(opts.ignore, pkg.check.ignore);
  opts.result = {
    errors: []
  };

  glob('**/*.js', opts, function(err, files) {
    if (err) return done(err);
    debug('project has %d files', files.length);

    opts.files = files;
    async.series({
      'missing dependencies': check.bind(null, opts, 'missing'),
      'extra dependencies': check.bind(null, opts, 'extra'),
      fmt: fmt.bind(null, opts),
      lint: lint.bind(null, opts)
    }, function(err) {
      if (err) {
        return done(err);
      }
      if (opts.result.errors.length > 0) {
        var error = new Error(format('%d check(s) failed', opts.result.errors.length));
        error.errors = opts.result.errors;
        return done(error);
      }
      return done();
    });
  });
};
