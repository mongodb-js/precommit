var dc = require('dependency-check');
var format = require('util').format;
var debug = require('debug')('mongodb-js-precommit');
var glob = require('glob');
var CLIEngine = require('eslint').CLIEngine;
var jsfmt = require('jsfmt');
var async = require('async');

function check(mode, done) {
  var pkg = require(process.cwd() + '/package.json');
  pkg['dependency-check'] = pkg['dependency-check'] || {
    entries: [],
    ignore: []
  };

  var opts = {
    path: process.cwd() + '/package.json',
    entries: pkg['dependency-check'].entries,
    ignore: pkg['dependency-check'].ignore
  };

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
    var successMsg;
    var corrector;

    if (mode === 'extra') {
      results = filterIgnored(dc.extra(pkg, deps, {
        excludeDev: true
      }));
      errMsg = 'Modules in package.json not used in code';
      corrector = 'npm uninstall --save ' + results.join(' ') + ';';
      successMsg = 'All dependencies in package.json are used in the code';
    } else {
      results = filterIgnored(dc.missing(pkg, deps));
      errMsg = 'Dependencies not listed in package.json';
      successMsg = 'All dependencies used in the code are listed in package.json';
      corrector = 'npm install --save ' + results.join(' ') + ';';
    }

    if (results.length === 0) {
      console.log('Success: ' + successMsg);
      return done();
    }
    console.error('Error: ' + errMsg + '. To fix this, run:\n\n    ' + corrector + '\n');
    return done(new Error(errMsg));
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
    return done(new Error(format('Please fix the %d error(s) above and try again.',
      report.errorCount)));
  }
  done();
};

module.exports = function(done){
  var opts = {};
  glob('**/*.js', { ignore: ['node_modules/**'] }, function (err, files) {
    if (err) return done(err);

    opts.files = files;

    async.series({
      'missing dependencies': check.bind(null, 'missing'),
      'extra dependencies': check.bind(null, 'extra'),
      lint: lint.bind(null, opts)
    }, done);
  });
};
