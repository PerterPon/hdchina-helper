
const macAddress = require('macaddress');
import * as _ from 'lodash';

import * as mysql from '../mysql';

import { TPTServer } from '../types';

export async function getCurrentServerInfo(): Promise<TPTServer> {
  const macs = await macAddress.all();
  const servers: TPTServer[] = await mysql.getAllServers();
  for (const interfaceName in macs) {
    const { mac } = macs[interfaceName];
    for (const server of servers) {
      const { macAddress } = server;
      if (true === _.isString(macAddress) && 0 < macAddress.length && mac === macAddress) {
        return server;
      }
    }
  }

  return null;
}
