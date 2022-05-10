
import * as puppeteer from 'puppeteer';
import { TItem } from 'src';
import * as config from './config';
import { sleep, randomInt } from './utils';
import * as url from 'url';
import * as log from './log';
import * as moment from 'moment';
import * as oss from './oss';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;
let torrentPage: puppeteer.Page = null;

export interface TPageUserInfo {
  shareRatio: string;
  uploadCount: string;
  downloadCount: string;
  magicPoint: string;
}

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.puppeteer;
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
      width: 600 + randomInt(600),
      height: 200 + randomInt(2000),
    }
  });

  page = await browser.newPage();
  // page.setCookie(cookie);
}

export async function refreshRecaptcha(): Promise<void> {
  log.log(`[Puppeteer] refreshRecaptcha`);
  const configInfo = config.getConfig();
  const { torrentPage } = configInfo
  await page.goto(torrentPage);
  await sleep(3 * 1000);
  await page.reload();
  await sleep(3 * 1000);
  await browser.close();
}

export async function loadTorrentPage(): Promise<void> {
  try {
    const configInfo = config.getConfig();
    const { torrentPage: torrentPageUrl } = configInfo
    const { cdnHost } = configInfo.aliOss;
    page.goto(torrentPageUrl);
    await sleep(5 * 1000);
    await page.mouse.move(
      100 + randomInt(200),
      200 + randomInt(100)
    );
    await page.mouse.move(
      100 + randomInt(200),
      200 + randomInt(100)
    );
    await page.mouse.move(
      100 + randomInt(200),
      200 + randomInt(100)
    );
    await page.mouse.move(
      100 + randomInt(200),
      200 + randomInt(100)
    );
    const screenShot: Buffer = await page.screenshot() as unknown as Buffer;
    const screenShotName: string = `${moment().format('YYYY-MM-DD_HH:mm:ss')}.png`;
    await oss.uploadScreenShot(screenShotName, screenShot);
    log.message(`[Puppeteer] screenshot: [http://${cdnHost}/screenshot/${screenShotName}]`);
    await page.waitForSelector('.userinfo', {
      timeout: 15 * 1000
    });
    torrentPage = page;
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }
}

export async function getUserInfo(): Promise<TPageUserInfo> {
  if (null === torrentPage) {
    await loadTorrentPage();
  }
  let magicP: puppeteer.ElementHandle<HTMLParagraphElement> = null;
  let ratioP: puppeteer.ElementHandle<HTMLParagraphElement> = null;
  const userInfo: TPageUserInfo = {
    shareRatio: '0',
    uploadCount: '0',
    downloadCount: '0',
    magicPoint: '0'
  };
  try {
    magicP = await torrentPage.$('.userinfo > p:nth-child(2)');
    const magicPointContent: string = await magicP.evaluate((el) => el.textContent) || '';
    const [magicPoint] = magicPointContent.match(/\d+\,\d+\.\d+/) || [];
    userInfo.magicPoint = magicPoint || '';
  } catch (e) {}
  try {
    ratioP = await torrentPage.$('.userinfo > p:nth-child(3)');
    const ratioContent: string = await ratioP.evaluate((el) => el.textContent) || '';
    const [shareRatio, uploadCount, downloadCount] = ratioContent.match(/\d+\.\d+/g) || [];
    userInfo.shareRatio = shareRatio;
    userInfo.uploadCount = uploadCount;
    userInfo.downloadCount = downloadCount;
  } catch (e) {}
  return userInfo;
}

export async function filterFreeItem(retryTime: number = 0): Promise<TItem[]> {
  log.log(`[Puppeteer] filterFreeItem with time: [${retryTime}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const { globalRetryTime, uid } = configInfo
  if (retryTime >= globalRetryTime) {
    return [];
  }
  retryTime++;
  if (null === torrentPage) {
    await loadTorrentPage();
  }

  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  let freeTarget: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  
  try {    
    await torrentPage.waitForSelector('.torrent_list > tbody > tr .pro_free', {
      timeout: 10 * 1000
    });
    torrentItems = await torrentPage.$$('.torrent_list > tbody > tr');
    try {
      const freeTarget1up = await torrentPage.$$('.torrent_list > tbody > tr .pro_free');
      freeTarget.push(...freeTarget1up);
    } catch (e) {}
    try {
      const freeTarget2up = await torrentPage.$$('.torrent_list > tbody > tr .pro_free2up');
      freeTarget.push(...freeTarget2up);
    } catch (e) {}
    log.log(`[Puppeteer] free target count: [${freeTarget.length}]`);
  } catch (e) {
    log.log(`[Puppeteer] failed to launch page with error: [${e.message}], wait for retry`);
  }

  for(const item of torrentItems) {
    let freeItem = null;
    freeItem = await item.$('.pro_free');
    if (null === freeItem) {
      freeItem = await item.$('.pro_free2up');
    }

    const progressArea = await item.$('.progressarea');
    if( null === freeItem || null !== progressArea ) {
      continue;
    }
    let freeTimeContainer: string = '';
    try {
      freeTimeContainer = await item.$eval('.pro_free', (el) => el.getAttribute('onmouseover'));
    } catch (e) {}
    try {
      if ('' === freeTimeContainer) {
        freeTimeContainer = await item.$eval('.pro_free2up', (el) => el.getAttribute('onmouseover'));
      }
    } catch (e) {}

    const [ freeTimeString ] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
    const freeTime: Date = new Date(freeTimeString);

    const torrentUrl: string = await item.$eval('.act .download', (el) => (el.parentNode as HTMLAnchorElement).getAttribute('href'))

    const idHref = await item.$eval('h3 a', (el) => el.getAttribute('href'));
    const [trash, id] = idHref.match(/id=(\d+)&/);
    const title: any = await item.$eval('h3 a', (el) => el.getAttribute('title'));

    const sizeString: string = await item.$eval('.t_size', (el) => el.innerHTML);
    const [ sizeNumberString ] = sizeString.match(/\d+/);
    const sizeNumber: number = Number(sizeNumberString)
    let size: number = 0;
    if (-1 < sizeString.indexOf('GB')) {
      size = sizeNumber * 1024 * 1024 * 1024
    } else if (-1 < sizeString.indexOf('MB')) {
      size = sizeNumber * 1024 * 1024;
    }

    const urlItem = url.parse(torrentUrl, true);

    freeItems.push({
      id, title, size,
      freeUntil: freeTime,
      free: true,
      torrentUrl: `${torrentUrl}&uid=${uid}`,
      hash: urlItem.query.hash as string
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
