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
const versionParts = packageJSON.version.split('.');
// The minor number (major.minor.patch) will always be even for stable so +1 will move to the next odd for pre release.
const version = `${versionParts[0]}.${Number(versionParts[1]) + 1}.${preReleaseTag}`;
const newpackageJSON =
  JSON.stringify(
    {
      ...packageJSON,
      version: version,
    },
    null,
    2
  ) + '\n';
fs.writeFileSync('./lana/package.json', newpackageJSON);
