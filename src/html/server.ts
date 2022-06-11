
import * as path from 'path';
import * as Koa from 'koa';
import * as Router from 'koa-router';
const Static = require('koa-static');
import * as bodyParser from 'koa-bodyparser';

import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';
import * as utils from '../utils';

import * as apis from './api';

const version = utils.getVersion();

async function start(): Promise<void> {
  await init();

  const configInfo = config.getConfig();
  const { htmlPort } = configInfo.server;

  const app = new Koa();
  const router = new Router();
  const staticMiddleware = Static(path.join(__dirname, 'static'));
  app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Content-Length, Authorization, Accept, X-Requested-With , yourHeaderFeild');
    ctx.set('Access-Control-Allow-Methods', 'PUT, POST, GET, DELETE, OPTIONS');
    if (ctx.method == 'OPTIONS') {
      ctx.body = 200; 
    } else {
      await next();
    }
  });
  app.use(staticMiddleware);
  app.use(bodyParser());
  app.use(async (ctx, next) => {
    const startTime: Date = new Date();
    console.log(`[${utils.displayTime()}] new request [${ctx.url}], query: [${ctx.querystring}], headers: [${JSON.stringify(ctx.headers)}], method: [${ctx.method}], body: [${JSON.stringify(ctx.request.body)}]`);
    await next();
    const costTime: number = Date.now() - startTime.getTime();
    console.log(`[${utils.displayTime()}] request: [${ctx.url}] cost time: [${costTime}ms]`);
  });

  router.post('/api', onMethod.bind(undefined, apis));

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.listen(htmlPort, async () => {
    console.log(`listing port: [${htmlPort}]`);
  });
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  await apis.init();
}

async function onMethod(targetMethods, ctx: Koa.Context): Promise<void> {
  const { method, data } = ctx.request.body;
  const tarMethod = targetMethods[method];
  if (undefined === tarMethod) {
    ctx.body = {
      success: false,
      message: `method: [${method}] did not found!`
    }
    ctx.status = 404;
  } else {
    const resData = await tarMethod(data);
    ctx.body = {
      success: true,
      message: 'ok',
      data: resData,
      version,
      method,
    }
  }
}

start();