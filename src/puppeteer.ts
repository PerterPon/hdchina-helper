
import * as puppeteer from 'puppeteer';
import { TItem } from './types';
import * as config from './config';
import { sleep, randomInt } from './utils';
import * as url from 'url';
import * as log from './log';
import * as moment from 'moment';
import * as oss from './oss';

import { TPageUserInfo } from './sites/basic';

import { siteMap } from './sites/basic';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;
let torrentPage: puppeteer.Page = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.puppeteer;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: null,
    ignoreDefaultArgs: [],
    userDataDir: userDataDir,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ],
    defaultViewport: {
      width: 1440,
      height: 2000
    }
  });

  page = await browser.newPage();
  page.setCookie(cookie);
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
