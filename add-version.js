
const path = require('path');
const fs = require('fs');

const versionFile = path.join(__dirname, 'version');
const versionContent = fs.readFileSync(versionFile, 'utf-8');
const versionItem = versionContent.split('.');
versionItem[2] = Number(versionItem[2]) + 1;
fs.writeFileSync(versionFile, versionItem.join('.'));
