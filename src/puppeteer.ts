
import * as puppeteer from 'puppeteer';
import * as config from './config';
import { displayTime, sleep } from './utils';

let browser: puppeteer.Browser = null;
let page: puppeteer.Page = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { cookie } = configInfo.hdchina.puppeteer;
  browser = await puppeteer.launch();
  page = await browser.newPage();
  page.setCookie(cookie);
}

export async function refreshRecaptcha(): Promise<void> {
  console.log(`[${displayTime()}] [Puppeteer] refreshRecaptcha`);
  const configInfo = config.getConfig();
  const { torrentPage } = configInfo.hdchina;
  await page.goto(torrentPage);
  await sleep(3 * 1000);
  await browser.close();
}
