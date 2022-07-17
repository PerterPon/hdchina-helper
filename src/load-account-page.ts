
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
import * as filesize from 'filesize';
import { mkdirpSync } from 'fs-extra';
import { Command } from 'commander';
import * as moment from 'moment-timezone';

import { TPageUserInfo } from './sites/basic';

import { TItem, TPTServer, TPTUserInfo, TSiteData } from './types';
import { createClientByServer, IClient } from './clients/basic';

import { main as startDownloader } from './downloader';

const program = new Command();

program
  .option('-s, --site <char>', 'separator character')
  .option('-n, --nickname <char>', 'separator character');

program.parse(process.argv);
config.setSite(program.site);
config.setNick(program.nickname);

config.init();

let tempFolder: string = null;

async function start(): Promise<void> {
  await init();
  const configInfo = config.getConfig();
  await puppeteer.doLoadPage(configInfo.indexPage);
}

async function init(): Promise<void> {
  log.log(`init`);
  await config.init();
  await initTempFolder();
  await mysql.init();
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfoByQuery({
    nickname: config.nickname,
    site: config.site
  });
  config.setUid(ptUserInfo.uid);
  config.setVip(ptUserInfo.vip);
  config.setUserInfo(ptUserInfo);
  await puppeteer.init(config.site, false);
}

async function initTempFolder(): Promise<void> {
  log.log(`initTempFolder`);
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
  config.setTempFolder(tempFolder);
}

start();
