import * as path from 'path';
import * as fs from 'fs';
import { load } from 'js-yaml';
import * as _ from 'lodash';
import { TPTUserInfo } from './types';

export interface TTBSConfig {
    [key: string]: any;
}

let config: TTBSConfig = null;

export function getEtcFolderPath(): string {
    const etcPath: string = path.join(__dirname, '../../etc');
    return etcPath;
}

export async function init(env?: string): Promise<TTBSConfig> {
    if (null !== config) {
        return config;
    }
    const etcPath: string = getEtcFolderPath();
    const defaultFilePath: string = path.join(etcPath, '/default.yaml');
    const defaultFileContent: string = fs.readFileSync(defaultFilePath, 'utf-8');
    const defaultConfig: TTBSConfig = load(defaultFileContent) as TTBSConfig;

    let listenConfig: TTBSConfig = {} as any;
    if (true === _.isString(env)) {
        const envFilePath: string = path.join(etcPath, `/${env}.yaml`);
        const envFileContent: string = fs.readFileSync(envFilePath, 'utf-8');
        const envConfig: TTBSConfig = load(envFileContent) as TTBSConfig;
        listenConfig = _.merge(defaultConfig, envConfig);
    } else {
        listenConfig = defaultConfig;
    }

    const { sites } = listenConfig;
    for (const siteName of sites) {
        const siteConfig = listenConfig[siteName];
        for (const configName in listenConfig) {
            if (-1 < sites.indexOf(configName) || 'sites' === configName) {
                continue;
            }
            const gloablConfig = listenConfig[configName];
            if (true === _.isObject(gloablConfig)) {
                const siteConfigItem = siteConfig[configName];
                siteConfig[configName] = _.assign({}, gloablConfig, siteConfigItem);
            } else {
                siteConfig[configName] = gloablConfig;
            }
        }
    }
    
    config = listenConfig;
    return listenConfig;
}

export function getConfig(): TTBSConfig {
    return config[site];
}

export let site: string = 'hdchina';
export let uid: string = '325966';
export let nickname: string = 'perterpon';
export let vip: boolean = false;
export let tempFolder: string = '';
export let userInfo: TPTUserInfo = null;

export function setSite(siteValue): void {
    site = siteValue || site;
}

export function setUid(uidValue): void {
    uid = uidValue || uid;
}

export function setNick(nicknameValue): void {
    nickname = nicknameValue || nickname;
}

export function setVip(vipValue): void {
    vip = vipValue || vip
}

export function setTempFolder(folderValue): void {
    tempFolder = folderValue || tempFolder;
}

export function setUserInfo(userInfoValue): void {
    userInfo = userInfoValue;
}
