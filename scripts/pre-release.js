// eslint-disable-next-line
const fs = require('fs');

// Update version for pre release
// get version string e.g 1.9.0 remove the last patch number (.0) and replace with yyyymmdd e.g 1.9.20230810
const today = new Date();
const preReleaseTag = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
  2,
  '0'
)}${today.getDate()}`;

// eslint-disable-next-line
const packageJSON = require('../lana/package.json');
const patchVersionIndex = packageJSON.version.lastIndexOf('.');
let version = packageJSON.version.slice(0, patchVersionIndex);
version = `${version}.${preReleaseTag}`;
const newpackageJSON =
  JSON.stringify(
    {
      ...packageJSON,
      version: version,
    },
    null,
    '\t'
  ) + '\n';
fs.writeFileSync('./lana/package.json', newpackageJSON);
