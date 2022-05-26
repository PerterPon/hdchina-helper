
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from './types';
import * as config from './config';
import { sleep } from './utils';
import * as log from './log';
import * as moment from 'moment';
import * as oss from './oss';
import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';

import { TPageUserInfo } from './sites/basic';

import { siteMap } from './sites/basic';
import { getUserInfo as getPTUserInfo } from './mysql';

let browser: puppeteer.Browser = null;
// let page: puppeteer.Page = null;
// let torrentPage: puppeteer.Page = null;
let cookieFileName: string = 'cookie';
let storageFileName: string = 'storage';
const pageMap: Map<string, puppeteer.Page> = new Map();

export async function init(): Promise<void> {
  if (browser !== null) {
    return;
  }
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.puppeteer;
  await mkdirp(userDataDir);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: null,
    ignoreDefaultArgs: [],
    args: [
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ],
    defaultViewport: {
      width: 1440,
      height: 2000
    }
  });

}

export async function loadPage(url: string, force: boolean = false): Promise<puppeteer.Page> {
  log.log(`[Puppeteer] loadPage url: [${url}], force: [${force}]`);
  let page: puppeteer.Page = pageMap.get(url);
  if (undefined === page || true === force) {
    log.log(`[Puppeteer] force lode page url: [${url}], force: [${force}]`);

    page = await browser.newPage();
    await setCookie(page);
    pageMap.set(url, page);
    console.log('======', url);
    await page.goto(url);
    await sleep(5 * 1000);
  }
  return page;
}

export async function close(): Promise<void> {
  await browser.close();
}

export async function setCookie(currentPage: puppeteer.Page): Promise<void> {
  log.log(`[PUPPETEER] setCookie`);

  const configInfo = config.getConfig();
  const userInfo: TPTUserInfo = await getPTUserInfo(config.nickname, config.site);
  const { cookie } = userInfo;
  const cookieItems: string[] = cookie.split(';');
  const cookies: puppeteer.SetCookie[] = [];
  const { domain } = configInfo.puppeteer.cookie;
  for (const item of cookieItems) {
    const [name, value] = item.split('=');
    cookies.push({
      name: name.trim(),
      value: value.trim(),
      domain: domain
    });
  }

  await currentPage.setCookie(...cookies);
}

export async function setCookieAndStorage(currentPage: puppeteer.Page): Promise<void> {
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
      currentPage.setCookie(...cookie);
    } catch (e) {
      log.log(e, cookiesValue);
    }
  } else {
    currentPage.setCookie(cookie);
  }

  if (true === fs.existsSync(storageFile)) {
    const storageValue: string = fs.readFileSync(storageFile, 'utf-8');
    log.log(`[PUPPETEER] set storage with value: [${storageFile}]`);
    await currentPage.evaluate((storageValue) => {
      const storage = JSON.parse(storageValue);
      (window as any).localStorage = storage;
    }, storageValue);
  }
}

export async function getUserInfo(): Promise<TPageUserInfo> {
  log.log(`[PUPPETEER] get user info`);
  const configInfo = config.getConfig();
  const page: puppeteer.Page = await loadPage(configInfo.torrentPage[0]);
  return siteMap[config.site].getUserInfo(page);
}

export async function loadTorrentPage(torrentPageUrl: string): Promise<void> {
  log.message(`[PUPPETEER] loadTorrentPage: [${torrentPageUrl}]`);
  try {
    const configInfo = config.getConfig();
    const { cdnHost } = configInfo.aliOss;
    const page = await loadPage(torrentPageUrl);
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
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }
}

export async function filterVIPItem(torrentPageUrl: string): Promise<TItem[]> {
  log.log(`[PUPPETEER] filterVIPItem with url: [${torrentPageUrl}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const currentSite = siteMap[config.site];
  const page: puppeteer.Page = await loadPage(torrentPageUrl);

  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];

  const { siteAnchor } = configInfo;

  try {
    await page.waitForSelector(siteAnchor.torrentItemWaiter, {
      timeout: 10 * 1000
    });
    torrentItems = await page.$$(siteAnchor.torrentItem);
  } catch (e) {
    log.log(`[Puppeteer] failed to launch page with error: [${e.message}], wait for retry`);
  }

  for(const item of torrentItems) {

    const downloaded: boolean = await currentSite.isDownloaded(item);
    if (true === downloaded) {
      continue;
    }

    let freeTime: Date = new Date('2030-01-01');

    let torrentUrl: string = await item.$eval(siteAnchor.torrentUrlAnchor, (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;

    const id: string = await currentSite.getSiteId(item, torrentUrl);
    const title: string = await currentSite.getTitle(item);
    const size: number = await currentSite.getSize(item);

    freeItems.push({
      id, title, size,
      freeUntil: freeTime,
      free: true,
      uid: config.uid,
      torrentUrl: torrentUrl,
      site: config.site,
      serverId: -1
    });
  }
  return freeItems;
}

export async function filterFreeItem(torrentPageUrl: string, retryTime: number = 0): Promise<TItem[]> {
  log.log(`[Puppeteer] filterFreeItem with time: [${retryTime}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const currentSite = siteMap[config.site];
  const { globalRetryTime, uid } = configInfo;
  if (retryTime >= globalRetryTime) {
    return [];
  }
  const shouldForceLoad: boolean = 0 < retryTime;
  const page: puppeteer.Page = await loadPage(torrentPageUrl, shouldForceLoad);
  retryTime++;

  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  let freeTarget: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];

  const { siteAnchor } = configInfo;

  try {
    await page.waitForSelector(siteAnchor.torrentItemWaiter, {
      timeout: 10 * 1000
    });
    torrentItems = await page.$$(siteAnchor.torrentItem);
    try {
      const freeTarget1up = await page.$$(siteAnchor.freeItem1upTag);
      freeTarget.push(...freeTarget1up);
    } catch (e) {}
    try {
      const freeTarget2up = await page.$$(siteAnchor.freeItem2upTag);
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

    try {
      const title1: string = await currentSite.getTitle(item);
      console.log(title1, null === freeItem);
    } catch (e) {
      console.log(e.message);
    }

    const downloaded: boolean = false; // await currentSite.isDownloaded(item);

    console.log(downloaded);
    if( null === freeItem ) {
      log.log(`[PUPPETEER] free Item === null: [${null === freeItem}] downloaded: [${downloaded}]`);
      continue;
    }
    let freeTime: Date = null;
    try {
      freeTime = await currentSite.getFreeTime(item);
    } catch (e) {
      log.log(e.message, e.stack);
    }
    try {
      if (null === freeTime) {
        freeTime = await currentSite.getFreeTime2up(item);
      }
    } catch (e) {
      log.log(e.message, e.stack);
    }

    let torrentUrl: string = await item.$eval(siteAnchor.torrentUrlAnchor, (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;

    const id: string = await currentSite.getSiteId(item, torrentUrl);
    const title: string = await currentSite.getTitle(item);
    const size: number = await currentSite.getSize(item);

    freeItems.push({
      id, title, size,
      freeUntil: freeTime,
      free: true,
      uid: config.uid,
      torrentUrl: torrentUrl,
      site: config.site,
      serverId: -1
    });
  }
  if (0 === freeItems.length && 0 === freeTarget.length) {
    await sleep(5 * 1000);
    return filterFreeItem(torrentPageUrl, retryTime);
  }
  console.log(JSON.stringify(freeItems));
  return freeItems;
}
