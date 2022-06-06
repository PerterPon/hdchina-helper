
import axios from 'axios';

import { TPTServer } from 'src/types';
import * as config from './src/config';
import * as mysql from './src/mysql';

config.init();

async function start(): Promise<void> {
  await mysql.init();

  const allServer: TPTServer[] = await mysql.getAllServers();
  for (const server of allServer) {
    const { ip, agentPort } = server;
    console.log(`deploying [${ip}]`);
    const res = await axios.post(`http://${ip}:${agentPort}/agent`, {
      method: 'deploy'
    });
    console.log(res.data);
  }

  console.log('all deploy done');
  process.exit(0);
}

start();
