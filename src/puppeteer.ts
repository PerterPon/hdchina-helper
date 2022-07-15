
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from './types';
import * as config from './config';
import { sleep } from './utils';
import * as log from './log';
import * as oss from './oss';
import * as utils from './utils';
import * as mysql from './mysql';

import * as fs from 'fs-extra';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as _ from 'lodash';
import * as filesize from 'filesize';

import { TPageUserInfo } from './sites/basic';

import { siteMap } from './sites/basic';
import { getUserInfoByQuery } from './mysql';

let browser: puppeteer.Browser = null;
let cookieFileName: string = 'cookie';
let storageFileName: string = 'storage';
const pageMap: Map<string, puppeteer.Page> = new Map();

export async function init(headless: boolean = true): Promise<void> {
  log.log(`[Puppeteer] init`);
  if (browser !== null) {
    return;
  }
  const userDataDir: string = await getUserDataDir();
  await mkdirp(userDataDir);
  browser = await puppeteer.launch({
    headless: headless,
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

export async function doLoadPage(url: string): Promise<puppeteer.Page> {
  log.log(`[Puppeteer] doLoadPage, url: [${url}]`);
  const page = await browser.newPage();
  await setCookie(page);
  pageMap.set(url, page);
  page.goto(url, {
    timeout: 600 * 1000
  }).catch((e) => {
    log.log(e);
  });

  return page;
}

export async function loadPage(url: string, force: boolean = false): Promise<puppeteer.Page> {
  log.log(`[Puppeteer] loadPage url: [${url}], force: [${force}]`);
  let page: puppeteer.Page = pageMap.get(url);
  const configInfo = config.getConfig();
  if (undefined === page || true === force) {
    log.log(`[Puppeteer] force lode page url: [${url}], force: [${force}]`);

    page = await this.doLoadPage(url);
    log.log(`[Puppeteer] waiting for load page: [${url}]`);
    let loadPageError: Error = null;
    try {
      await page.waitForSelector(configInfo.siteAnchor.pageWaiter, {
        timeout: 60 * 1000
      });
      await sleep(5 * 1000);
    } catch (e) {
      loadPageError = e;
    }
    const screenShot: Buffer = await page.screenshot() as unknown as Buffer;
    const screenShotName: string = `${config.site}_${config.uid}_${utils.displayTime()}.png`;
    await oss.uploadScreenShot(screenShotName, screenShot);
    log.message(`[Puppeteer] screenshot: [http://${configInfo.aliOss.cdnHost}/screenshot/${screenShotName}]`);

    if (loadPageError !== null) {
      throw loadPageError;
    }
  }
  return page;
}

export async function close(): Promise<void> {
  await browser.close();
}

export async function setCookie(currentPage: puppeteer.Page): Promise<void> {
  log.log(`[Puppeteer] setCookie`);

  const configInfo = config.getConfig();
  const userInfo: TPTUserInfo = await getUserInfoByQuery({
    nickname: config.nickname,
    site: config.site
  });
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
  log.log(`[Puppeteer] setCookieAndStorage`);
  const configInfo = config.getConfig();
  const { cookie } = configInfo.puppeteer;
  const userDataDir: string = await getUserDataDir();
  const cookieFile: string = path.join(userDataDir, cookieFileName);
  const storageFile: string = path.join(userDataDir, storageFileName);
  if (true === fs.existsSync(cookieFile)) {
    const cookiesValue: string = fs.readFileSync(cookieFile, 'utf-8');
    log.log(`[Puppeteer] set local cookie: [${cookiesValue}]`);
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
    log.log(`[Puppeteer] set storage with value: [${storageFile}]`);
    await currentPage.evaluate((storageValue) => {
      const storage = JSON.parse(storageValue);
      (window as any).localStorage = storage;
    }, storageValue);
  }
}

export async function getUserInfo(): Promise<TPageUserInfo> {
  log.log(`[Puppeteer] get user info`);
  const configInfo = config.getConfig();
  const page: puppeteer.Page = await loadPage(configInfo.torrentPage[0]);
  return siteMap[config.site].getUserInfo(page);
}

export async function loadTorrentPage(torrentPageUrl: string): Promise<void> {
  log.message(`[Puppeteer] loadTorrentPage: [${torrentPageUrl}]`);
  try {
    const configInfo = config.getConfig();
    const { cdnHost } = configInfo.aliOss;
    const page = await loadPage(torrentPageUrl);
    const screenShot: Buffer = await page.screenshot() as unknown as Buffer;
    const screenShotName: string = `${config.site}_${config.uid}_${utils.displayTime()}.png`;
    await oss.uploadScreenShot(screenShotName, screenShot);
    log.message(`[Puppeteer] screenshot: [http://${cdnHost}/screenshot/${screenShotName}]`);
    await page.waitForSelector(configInfo.siteAnchor.pageWaiter, {
      timeout: 15 * 1000
    });
    const { cookies } = await (page as any)._client.send('Network.getAllCookies') || {};
    const userDataDir: string = await getUserDataDir();
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
  log.log(`[Puppeteer] filterVIPItem with url: [${torrentPageUrl}]`);
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

  const stickyItems: TItem[] = [];
  torrentItems = torrentItems.slice(1);
  for(const item of torrentItems) {

    let freeTime: Date = utils.parseCSTDate('2030-01-01');

    let torrentUrl: string = await item.$eval(siteAnchor.torrentUrlAnchor, (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;

    const id: string = await currentSite.getSiteId(item, torrentUrl);
    const title: string = await currentSite.getTitle(item);
    const size: number = await currentSite.getSize(item);
    const publishDate: Date = await currentSite.publishDate(item);
    const isSticky: boolean = await currentSite.isSticky(item);

    log.log(`[Puppeteer] scraping item: [${title}], size: [${filesize(size)}], publish date: [${publishDate}]`);
    if (true === isSticky) {
      stickyItems.push({
        id, title, size, publishDate,
        freeUntil: freeTime,
        free: true,
        uid: config.uid,
        torrentUrl: torrentUrl,
        site: config.site,
        serverId: -1
      });
    } else {
      freeItems.push({
        id, title, size, publishDate,
        freeUntil: freeTime,
        free: true,
        uid: config.uid,
        torrentUrl: torrentUrl,
        site: config.site,
        serverId: -1
      });
    }
  }

  const dateSortedItems: TItem[] = _.sortBy(freeItems, 'publishDate').reverse();
  const { vipNormalItemCount } = config.userInfo;
  const latestItems: TItem[] = dateSortedItems.slice(0, vipNormalItemCount);
  const vipItems = latestItems.concat(stickyItems);
  return vipItems;
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

  // the first one is title
  torrentItems = torrentItems.slice(1);
  for(const item of torrentItems) {
    const isFree: boolean = await currentSite.checkFreeItem(item);

    const title: string = await currentSite.getTitle(item);
    const size: number = await currentSite.getSize(item);
    const publishDate: Date = await currentSite.publishDate(item);
    const downloaded: boolean = await currentSite.isDownloaded(item);
    log.log(`[Puppeteer] scraping item: [${title}] is free: [${isFree}] downloaded: [${downloaded}], size: [${filesize(size)}], publish date: [${publishDate}]`);

    let freeTime: Date = null;
    try {
      freeTime = await currentSite.getFreeTime(item, isFree);
    } catch (e) {
      // log.log(e.message, e.stack);
    }
    try {
      if (null === freeTime) {
        freeTime = await currentSite.getFreeTime2up(item, isFree);
      }
    } catch (e) {
      // log.log(e.message, e.stack);
    }

    console.log(freeTime);

    let torrentUrl: string = await item.$eval(siteAnchor.torrentUrlAnchor, (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;
    const id: string = await currentSite.getSiteId(item, torrentUrl);

    freeItems.push({
      id, title, size, publishDate,
      freeUntil: freeTime,
      free: isFree,
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
  return freeItems;
}

export async function downloadFile(downloadUrl: string, downloadPath: string, fileName: string): Promise<void> {
  log.log(`[Puppeteer] downloadFile, downloadUrl: [${downloadUrl}], downloadPath: [${downloadPath}], fileName: [${fileName}]`);
  const puppeteerTempPath: string = path.join(downloadPath, 'puppeteer_temp');
  fs.removeSync(puppeteerTempPath);

  const page: puppeteer.Page = await browser.newPage();
  await (page as any)._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: puppeteerTempPath,
  });
  await mkdirp(puppeteerTempPath);
  const res: puppeteer.Response = await page.goto(downloadUrl);
  await sleep(3 * 1000);
  const files: string[] = fs.readdirSync(puppeteerTempPath);
  if (0 === files.length) {
    log.log(`[ERROR][Puppeteer] trying to download file but failed!`);
    return;
  }
  const srcFile: string = files[0];
  const tarFile: string = path.join(downloadPath, fileName);
  fs.moveSync(srcFile, tarFile);
}

async function getUserDataDir(): Promise<string> {
  const userInfo: TPTUserInfo = config.userInfo;
  return path.join(config.tempFolder, 'puppeteer', userInfo.uid);
}
