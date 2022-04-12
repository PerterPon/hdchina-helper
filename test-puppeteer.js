const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless:true
  });
  const page = await browser.newPage();
  await page.setCookie({
    name: 'hdchina',
    value: '4d405cb7e86f8efc45afceb147dd800f8ab75be59fd9523732c068f896b7a3de',
    domain: 'hdchina.org'
  });
  await page.goto('https://hdchina.org/torrents.php');
})();