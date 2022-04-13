
import * as puppeteer from 'puppeteer';
import { TItem } from 'src';
import * as config from './config';
import { displayTime, sleep } from './utils';
import * as url from 'url';
import * as log from './log';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.hdchina.puppeteer;
  browser = await puppeteer.launch({
    userDataDir: userDataDir,
    headless: false,
    defaultViewport: {
      width: 1123,
      height: 987
    },
    args: [
      '--no-sandbox',
    ],
  });
  page = await browser.newPage();
  page.setCookie(cookie);
}

export async function refreshRecaptcha(): Promise<void> {
  log.log(`[${displayTime()}] [Puppeteer] refreshRecaptcha`);
  const configInfo = config.getConfig();
  const { torrentPage } = configInfo.hdchina;
  await page.goto(torrentPage);
  await sleep(3 * 1000);
  await page.reload();
  await sleep(3 * 1000);
  await browser.close();
}

export async function filterFreeItem(retryTime: number = 0): Promise<TItem[]> {
  log.log(`[${displayTime()}] [Puppeteer] filterFreeItem with time: [${retryTime}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const { torrentPage, globalRetryTime, uid } = configInfo.hdchina;
  if (retryTime >= globalRetryTime) {
    return [];
  }
  retryTime++;

  
  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  let freeTarget: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  
  try {
    page.goto(torrentPage, {
      timeout: 15 * 1000
    });
    await page.waitForSelector('.torrent_list > tbody > tr .pro_free', {
      timeout: 10 * 1000
    });
    torrentItems = await page.$$('.torrent_list > tbody > tr');
    freeTarget = await page.$$('.torrent_list > tbody > tr .pro_free');
    log.log(`[${displayTime()}] [Puppeteer] free target count: [${freeTarget.length}]`);
  } catch (e) {
    log.log(`[${displayTime()}] [Puppeteer] failed to launch page, wait for retry`);
  }

  for(const item of torrentItems) {
    let freeItem;
    try {
      freeItem = await item.$('.pro_free')
    } catch (e) {
      freeItem = await item.$('.pro_free2up');
    }
    const progressArea = await item.$('.progressarea');
    if( null === freeItem || null !== progressArea ) {
      continue;
    }
    const freeTimeContainer: string = 
      await item.$eval('.pro_free', (el) => el.getAttribute('onmouseover')) ||
      await item.$eval('.pro_free2up', (el) => el.getAttribute('onmouseover'));
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
  if (0 === freeItems.length) {
    await sleep(5 * 1000);
    return filterFreeItem(retryTime);
  }
  await browser.close();
  return freeItems;
}
