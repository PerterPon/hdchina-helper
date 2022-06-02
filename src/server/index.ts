
import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as Static from 'koa-static';
import * as bodyParser from 'koa-bodyparser';

import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';
import * as utils from '../utils';

import * as rpcMethods from './rpc';
import * as agentMethods from './agent';
import * as url from 'url';
import axios from 'axios';

const version = utils.getVersion();

async function start(): Promise<void> {
  await init();
  const configInfo = config.getConfig();
  const { port } = configInfo.server;
  
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  app.use(async (ctx, next) => {
    const startTime: Date = new Date();
    console.log(`[${utils.displayTime()}] new request [${ctx.url}], query: [${ctx.querystring}], headers: [${JSON.stringify(ctx.headers)}], method: [${ctx.method}], body: [${JSON.stringify(ctx.request.body)}]`);
    await next();
    const costTime: number = Date.now() - startTime.getTime();
    console.log(`[${utils.displayTime()}] request: [${ctx.url}] cost time: [${costTime}ms]`);
  });
  
  router.post('/rpc', onMethod.bind(undefined, rpcMethods));
  router.post('/agent', onMethod.bind(undefined, agentMethods));
  
  app.use(router.routes());
  app.use(router.allowedMethods());
  
  app.listen(port, async () => {
    await rpcMethods.init();
    console.log(`listing port: [${port}]`);
  });
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  await rpcMethods.init();
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
