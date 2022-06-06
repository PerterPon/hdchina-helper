
import * as koa from 'koa';
import * as fs from 'fs-extra';
import * as path from 'path';

import * as mysql from '../mysql';
import { TPTUserInfo } from 'src/types';

import { execSync } from 'child_process';

const CRONTAB_FILE = '/etc/crontab';
const DEPLOY_FILE = path.join(__dirname, '../../deploy.sh');

export async function getCrontab(ctx: koa.Context): Promise<void> {

}

export async function removeCrontab(ctx: koa.Context): Promise<void> {
  const uid: string = ctx.query.uid as string;
  const site: string = ctx.query.site as string;
  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({uid, site});
}

export async function addCrontab(ctx: koa.Context): Promise<void> {
  
}

// export async function deploy(ctx: koa.Context): Promise<void> {
//   execSync(DEPLOY_FILE);
//   ctx.
// }

async function readCrontab(): Promise<string> {
  const content: string = fs.readFileSync(CRONTAB_FILE, 'utf-8');
  return content;
}

