
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';
import * as mysql from './mysql';
import * as puppeteer from './puppeteer';
import * as log from './log';

import * as _ from 'lodash';
import * as path from 'path';
import { mkdirpSync } from 'fs-extra';
import { Command } from 'commander';
import { TPageUserInfo } from './sites/basic';

import { TItem } from './types';

const program = new Command();

program
  .option('-s, --site <char>', 'separator character')
  .option('-u, --uid <char>', 'separator character')
  .option('-e, --env <char>', 'separator character');

program.parse(process.argv);
config.setSite(program.site);
config.setUid(program.uid);

config.init();

let tempFolder: string = null;

async function start(): Promise<void> {
  try {
    await main();
  } catch(e) {
    log.log(e.message);
    log.log(e.stack);
    log.message('[ERROR!]');

    await message.sendMessage();
    await utils.sleep(2 * 1000);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await init();
  // 1. 
  const userInfo: TPageUserInfo = await puppeteer.getUserInfo();
  const { shareRatio, downloadCount, uploadCount, magicPoint } = userInfo;
  log.message(`share ratio: [${shareRatio || ''}]`);
  log.message(`upload count: [${uploadCount || ''}]`);
  log.message(` download count: [${downloadCount || ''}]`);
  log.message(`matic point: [${magicPoint || ''}]`)

  // 2.
  await mysql.storeSiteInfo(Number(shareRatio), Number(downloadCount), Number(uploadCount), Number(magicPoint));

  // 3.
  const freeItems: TItem[] = await puppeteer.filterFreeItem();
  log.log(`got free items: [${JSON.stringify(freeItems)}]`);
  // 4. 
  await mysql.storeItem(freeItems);

  await message.sendMessage();
  await utils.sleep(5 * 1000);
  process.exit(0);
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  await transmission.init();
  await oss.init();
  await message.init();
  await puppeteer.init();
  await initTempFolder();
}

async function initTempFolder(): Promise<void> {
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
}

start();
