import * as path from 'path';
import * as fs from 'fs';
import { load } from 'js-yaml';
import * as _ from 'lodash';

export interface TTBSConfig {
    [key: string]: any;
}

let config: TTBSConfig;

export function getEtcFolderPath(): string {
    const etcPath: string = path.join(__dirname, '../../etc');
    return etcPath;
}

export async function init(env?: string): Promise<TTBSConfig> {
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

    config = listenConfig;

    return listenConfig;
}

export function getConfig(): TTBSConfig {
    return config;
}

