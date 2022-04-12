
import * as puppeteer from 'puppeteer';
import * as config from './config';
import { displayTime, sleep } from './utils';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie } = configInfo.hdchina.puppeteer;
  browser = await puppeteer.launch({
    defaultViewport: {
      width: 1123,
      height: 987
    }
  });
  page = await browser.newPage();
  page.setCookie(cookie);
}

export async function refreshRecaptcha(): Promise<void> {
  console.log(`[${displayTime()}] [Puppeteer] refreshRecaptcha`);
  const configInfo = config.getConfig();
  const { torrentPage } = configInfo.hdchina;
  await page.goto(torrentPage);
  await sleep(3 * 1000);
  await page.reload();
  await sleep(3 * 1000);
  await browser.close();
}
