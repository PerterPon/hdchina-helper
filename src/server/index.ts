
import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as Static from 'koa-static';

import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';
import * as utils from '../utils';
import * as url from 'url';
import axios from 'axios';

config.init();
mysql.init();
const configInfo = config.getConfig();
const { port } = configInfo.server;

const app = new Koa();
const router = new Router();
app.use(async (ctx, next) => {
  console.log(`[${utils.displayTime()}] new request [${ctx.url}], query: [${ctx.querystring}], headers: [${JSON.stringify(ctx.headers)}], method: [${ctx.method}]`);
  await next();
});

app.use(async (ctx, next) => {
  const urlItem = url.parse(ctx.url, true);
  urlItem.host = 'www.baidu.com';
  urlItem.protocol = 'https';
  const headers: any = ctx.headers;
  headers.host = 'www.baidu.com';
  const res = await axios.get(url.format(urlItem), {
    headers: headers
  });
  console.log(res.data);
  ctx.body = res.data;
  console.log(res.headers);
  ctx.set(res.headers);
  // await next();
});

// router.get('/test', async (ctx, next) => {
//   const urlItem = url.parse(ctx.url, true);
//   urlItem.host = 'www.baidu.com';
//   urlItem.protocol = 'https';
//   const headers: any = ctx.headers;
//   headers.host = 'www.baidu.com';
//   const res = await axios.get(url.format(urlItem), {
//     headers: headers
//   });
//   console.log(res.data);
//   ctx.body = res.data;
//   console.log(res.headers);
//   ctx.set(res.headers);
// });

// app.use(router.routes());
// app.use(router.allowedMethods());

app.listen(port, () => {
  console.log(`listing port: [${port}]`);
});
