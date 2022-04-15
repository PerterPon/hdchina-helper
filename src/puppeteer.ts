
import * as puppeteer from 'puppeteer';
import { TItem } from 'src';
import * as config from './config';
import { displayTime, sleep } from './utils';
import * as url from 'url';
import * as log from './log';
import * as moment from 'moment';
import * as oss from './oss';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;

const DEFAULT_ARGS = [
  '--disable-background-networking',
  '--enable-features=NetworkService,NetworkServiceInProcess',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  // BlinkGenPropertyTrees disabled due to crbug.com/937609
  '--disable-features=TranslateUI,BlinkGenPropertyTrees',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-first-run',
  '--enable-automation',
  '--password-store=basic',
  '--use-mock-keychain',
];

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie, userDataDir } = configInfo.hdchina.puppeteer;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: null,
    ignoreDefaultArgs: DEFAULT_ARGS,
    args: [
        '--disable-features=site-per-process',
        '--enable-audio-service-sandbox',
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
    ],
    defaultViewport: {
      width: 1423,
      height: 3800
    }
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
  const { cdnHost } = configInfo.hdchina.aliOss;
  if (retryTime >= globalRetryTime) {
    return [];
  }
  retryTime++;

  let torrentItems: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  let freeTarget: puppeteer.ElementHandle<HTMLTableRowElement>[] = [];
  
  try {
    await page.goto(torrentPage, {
      timeout: 15 * 1000
    });
    const screenShot: Buffer = await page.screenshot() as unknown as Buffer;
    const screenShotName: string = `${moment().format('YYYY-MM-DD_HH:mm:ss')}.png`;
    await oss.uploadScreenShot(screenShotName, screenShot);
    log.message(`[${displayTime()}] [Puppeteer] screenshot: [http://${cdnHost}/screenshot/${screenShotName}]`);
    await page.waitForSelector('.torrent_list > tbody > tr .pro_free', {
      timeout: 10 * 1000
    });
    torrentItems = await page.$$('.torrent_list > tbody > tr');
    try {
      const freeTarget1up = await page.$$('.torrent_list > tbody > tr .pro_free');
      freeTarget.push(...freeTarget1up);
    } catch (e) {}
    try {
      const freeTarget2up = await page.$$('.torrent_list > tbody > tr .pro_free2up');
      freeTarget.push(...freeTarget2up);
    } catch (e) {}
    log.log(`[${displayTime()}] [Puppeteer] free target count: [${freeTarget.length}]`);
  } catch (e) {
    log.log(`[${displayTime()}] [Puppeteer] failed to launch page with error: [${e.message}], wait for retry`);
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
    return filterFreeItem(retryTime);
  }
  await browser.close();
  return freeItems;
}
