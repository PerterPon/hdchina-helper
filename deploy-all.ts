
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

import { TPTServer } from 'src/types';
import * as config from './src/config';
import * as mysql from './src/mysql';

config.init();

async function start(): Promise<void> {
  await mysql.init();

  const allServer: TPTServer[] = await mysql.getAllServers();
  const tasks = [];
  for (const server of allServer) {
    const { ip, agentPort } = server;
    console.log(`deploying [${ip}]`);
    const configFile = path.join(__dirname, 'etc', 'default.yaml');
    const configContent = fs.readFileSync(configFile, 'utf-8');
    const passContent = encodeURIComponent(configContent);
    const res = axios.post(`http://${ip}:${agentPort}/agent`, {
      method: 'deploy',
      data: {
        config: passContent
      }
    }).then((res) => {
      console.log(res.data);
    }).catch((e) => {
      console.log(e);
    });
    tasks.push(res);
  }

  await Promise.all(tasks);

  console.log('all deploy done');
  process.exit(0);
}

start();
