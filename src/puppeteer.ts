
import * as puppeteer from 'puppeteer';
import { TItem } from './types';
import * as config from './config';
import { sleep, randomInt } from './utils';
import * as url from 'url';
import * as log from './log';
import * as moment from 'moment';
import * as oss from './oss';
import * as fs from 'fs';
import * as path from 'path';

import { TPageUserInfo } from './sites/basic';

import { siteMap } from './sites/basic';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;
let torrentPage: puppeteer.Page = null;
let cookieFileName: string = 'cookie';
let storageFileName: string = 'storage';

export async function init(): Promise<void> {
  if (browser !== null) {
    return;
  }
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.puppeteer;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: null,
    ignoreDefaultArgs: [],
    args: [
        // `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ],
    defaultViewport: {
      width: 1440,
      height: 2000
    }
  });

  page = await browser.newPage();
  await page.setCookie(cookie);
  // await setCookieAndStorage();
}

export async function setCookieAndStorage(): Promise<void> {
  log.log(`[PUPPETEER] setCookieAndStorage`);
  const configInfo = config.getConfig();
  const { userDataDir, cookie } = configInfo.puppeteer;
  const cookieFile: string = path.join(userDataDir, cookieFileName);
  const storageFile: string = path.join(userDataDir, storageFileName);
  if (true === fs.existsSync(cookieFile)) {
    const cookiesValue: string = fs.readFileSync(cookieFile, 'utf-8');
    log.log(`[PUPPETEER] set local cookie: [${cookiesValue}]`);
    try {
      const cookie = JSON.parse(cookiesValue);
      page.setCookie(...cookie);
    } catch (e) {
      log.log(e, cookiesValue);
    }
  } else {
    page.setCookie(cookie);
  }

  if (true === fs.existsSync(storageFile)) {
    const storageValue: string = fs.readFileSync(storageFile, 'utf-8');
    log.log(`[PUPPETEER] set storage with value: [${storageFile}]`);
    await page.evaluate((storageValue) => {
      const storage = JSON.parse(storageValue);
      (window as any).localStorage = storage;
    }, storageValue);
  }
}

export async function getUserInfo(): Promise<TPageUserInfo> {
  log.log(`[PUPPETEER] get user info`);
  if (null === torrentPage) {
    await loadTorrentPage();
  }
  return siteMap[config.site].getUserInfo(torrentPage);
}

export async function loadTorrentPage(): Promise<void> {
  log.log(`[PUPPETEER] loadTorrentPage`);
  try {
    const configInfo = config.getConfig();
    const { torrentPage: torrentPageUrl } = configInfo;
    const { cdnHost } = configInfo.aliOss;
    page.goto(torrentPageUrl);
    await sleep(5 * 1000);
    const screenShot: Buffer = await page.screenshot() as unknown as Buffer;
    const screenShotName: string = `${config.site}_${config.uid}_${moment().format('YYYY-MM-DD_HH:mm:ss')}.png`;
    await oss.uploadScreenShot(screenShotName, screenShot);
    log.message(`[Puppeteer] screenshot: [http://${cdnHost}/screenshot/${screenShotName}]`);
    await page.waitForSelector(configInfo.siteAnchor.pageWaiter, {
      timeout: 15 * 1000
    });
    const { cookies } = await (page as any)._client.send('Network.getAllCookies') || {};
    const { userDataDir } = configInfo.puppeteer;
    const cookieFile: string = path.join(userDataDir, cookieFileName);
    fs.writeFileSync(cookieFile, JSON.stringify(cookies));

    const localStorage: string = await page.evaluate(() => JSON.stringify(window.localStorage));
    const storageFile: string = path.join(userDataDir, storageFileName);
    fs.writeFileSync(storageFile, localStorage);
    torrentPage = page;
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }
}

export async function filterFreeItem(retryTime: number = 0): Promise<TItem[]> {
  log.log(`[Puppeteer] filterFreeItem with time: [${retryTime}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const currentSite = siteMap[config.site];
  const { globalRetryTime, uid } = configInfo;
  if (retryTime >= globalRetryTime) {
    return [];
  }
  retryTime++;
  if (null === torrentPage) {
    await loadTorrentPage();
  }

  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  let freeTarget: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  
  const { siteAnchor } = configInfo;

  try {    
    await torrentPage.waitForSelector(siteAnchor.torrentItemWaiter, {
      timeout: 10 * 1000
    });
    torrentItems = await torrentPage.$$(siteAnchor.torrentItem);
    try {
      const freeTarget1up = await torrentPage.$$(siteAnchor.freeItem1upTag);
      freeTarget.push(...freeTarget1up);
    } catch (e) {}
    try {
      const freeTarget2up = await torrentPage.$$(siteAnchor.freeItem2upTag);
      freeTarget.push(...freeTarget2up);
    } catch (e) {}
    log.log(`[Puppeteer] free target count: [${freeTarget.length}]`);
  } catch (e) {
    log.log(`[Puppeteer] failed to launch page with error: [${e.message}], wait for retry`);
  }

  for(const item of torrentItems) {
    let freeItem = null;
    freeItem = await item.$(siteAnchor.freeItem1up);
    if (null === freeItem) {
      freeItem = await item.$(siteAnchor.freeItem2up);
    }

    const progressArea = await item.$(siteAnchor.progressArea);
    if( null === freeItem || null !== progressArea ) {
      continue;
    }
    let freeTimeContainer: string = '';
    try {
      freeTimeContainer = await currentSite.getFreeTime(item);
    } catch (e) {}
    try {
      if ('' === freeTimeContainer) {
        freeTimeContainer = await currentSite.getFreeTime2up(item);
      }
    } catch (e) {}

    const [ freeTimeString ] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
    const freeTime: Date = new Date(freeTimeString);
    let torrentUrl: string = await item.$eval(siteAnchor.torrentUrlAnchor, (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;

    const id: string = await currentSite.getSiteId(item);
    const title: string = await currentSite.getTitle(item);
    const size: number = await currentSite.getSize(item);

    const urlItem = url.parse(torrentUrl, true);

    freeItems.push({
      id, title, size,
      freeUntil: freeTime,
      free: true,
      uid: config.uid,
      torrentUrl: torrentUrl,
      site: config.site
    });
  }
  if (0 === freeItems.length && 0 === freeTarget.length) {
    await sleep(5 * 1000);
    torrentPage = null;
    return filterFreeItem(retryTime);
  }
  await browser.close();
  return freeItems;
}
