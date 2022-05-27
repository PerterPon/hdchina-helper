
import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as Static from 'koa-static';

import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';
import * as utils from '../utils';

config.init();
mysql.init();
const configInfo = config.getConfig();
const { port } = configInfo.server;

const app = new Koa();
const router = new Router();
app.use(async (ctx, next) => {
  console.log(`[${utils.displayTime()}] new request [${ctx.url}], query: [${ctx.querystring}]`);
  await next();
});

// app.use(async (ctx, next) => {
//   ctx.se
//   await next();
// });

router.get('/test', (ctx, next) => {
  ctx.body = '12345';
});

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(port, () => {
  console.log(`listing port: [${port}]`);
});
