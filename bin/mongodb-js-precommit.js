#!/usr/bin/env node

require('../')(function(err) {
  if (err) {
    console.error(err);
    return process.exit(1);
  }
  console.log('ok');
});
