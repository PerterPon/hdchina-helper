/* eslint-disable @typescript-eslint */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QBittorrent = void 0;
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
const fs_1 = require("fs");
const url_1 = require("url");
const formdata_node_1 = require("formdata-node");
const file_from_path_1 = require("formdata-node/file-from-path");
// import got from 'got';
const tough_cookie_1 = require("tough-cookie");
// import { magnetDecode } from '@ctrl/magnet-link';
// import { TorrentState as NormalizedTorrentState, } from '@ctrl/shared-torrent';
// import { hash } from '@ctrl/torrent-file';
// import { urlJoin } from '@ctrl/url-join';
const NormalizedTorrentState = {
    downloading: "downloading",
    seeding: "seeding",
    paused: "paused",
    queued: "queued",
    checking: "checking",
    error: "error",
    unknown: "unknown",
};
const pathLib = require("path");
const types_1 = require("./types");
const defaults = {
    baseUrl: 'http://localhost:9091/',
    path: '/api/v2',
    username: '',
    password: '',
    timeout: 5000,
};
class QBittorrent {
    config: any
    constructor(options = {}) {
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /**
         * auth cookie
         */
        Object.defineProperty(this, "_sid", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /**
         * cookie expiration
         */
        Object.defineProperty(this, "_exp", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.config = { ...defaults, ...options };
    }
    /**
     * @deprecated
     */
    async version() {
        return this.getAppVersion();
    }
    /**
     * Get application version
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-application-version}
     */
    async getAppVersion() {
        const res = await this.request('/app/version', 'GET', undefined, undefined, undefined, undefined, false);
        return res.body;
    }
    async getApiVersion() {
        const res = await this.request('/app/webapiVersion', 'GET', undefined, undefined, undefined, undefined, false);
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-build-info}
     */
    async getBuildInfo() {
        const res = await this.request('/app/buildInfo', 'GET');
        return res.body;
    }
    async getTorrent(hash) {
        const torrentsResponse = await this.listTorrents({ hashes: hash });
        const torrentData = torrentsResponse[0];
        if (!torrentData) {
            throw new Error('Torrent not found');
        }
        return this._normalizeTorrentData(torrentData);
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-application-preferences}
     */
    async getPreferences() {
        const res = await this.request('/app/preferences', 'GET');
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-application-preferences}
     */
    async setPreferences(preferences) {
        await this.request('/app/setPreferences', 'POST', undefined, undefined, {
            json: JSON.stringify(preferences),
        });
        return true;
    }
    /**
     * Torrents list
     * @param hashes Filter by torrent hashes
     * @param [filter] Filter torrent list
     * @param category Get torrents with the given category (empty string means "without category"; no "category" parameter means "any category")
     * @returns list of torrents
     */
    async listTorrents(args: any = {}) {
        const { hashes, filter, category, sort, offset, reverse, tag } = args;
        const params: any = {};
        if (hashes) {
            params.hashes = this._normalizeHashes(hashes);
        }
        if (filter) {
            params.filter = filter;
        }
        if (category) {
            params.category = category;
        }
        if (tag) {
            params.tag = tag;
        }
        if (offset !== undefined) {
            params.offset = `${offset}`;
        }
        if (sort) {
            params.sort = sort;
        }
        if (reverse) {
            params.reverse = JSON.stringify(reverse);
        }
        const res = await this.request('/torrents/info', 'GET', params);
        return res.body;
    }
    async getAllData() {
        const listTorrents: any = await this.listTorrents();
        const results = {
            torrents: [],
            labels: [],
        };
        const labels = {};
        for (const torrent of listTorrents) {
            const torrentData = this._normalizeTorrentData(torrent);
            results.torrents.push(torrentData);
            // setup label
            if (torrentData.label) {
                if (labels[torrentData.label] === undefined) {
                    labels[torrentData.label] = {
                        id: torrentData.label,
                        name: torrentData.label,
                        count: 1,
                    };
                }
                else {
                    labels[torrentData.label].count += 1;
                }
            }
        }
        return results;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-generic-properties}
     */
    async torrentProperties(hash) {
        const res = await this.request('/torrents/properties', 'GET', { hash });
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-trackers}
     */
    async torrentTrackers(hash) {
        const res = await this.request('/torrents/trackers', 'GET', { hash });
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-web-seeds}
     */
    async torrentWebSeeds(hash) {
        const res = await this.request('/torrents/webseeds', 'GET', { hash });
        return res.body;
    }
    async torrentFiles(hash) {
        const res = await this.request('/torrents/files', 'GET', { hash });
        return res.body;
    }
    async setFilePriority(hash, fileIds, priority) {
        const res = await this.request('/torrents/filePrio', 'GET', {
            hash,
            id: this._normalizeHashes(fileIds),
            priority,
        });
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-pieces-states}
     */
    async torrentPieceStates(hash) {
        const res = await this.request('/torrents/pieceStates', 'GET', { hash });
        return res.body;
    }
    /**
     * Torrents piece hashes
     * @returns an array of hashes (strings) of all pieces (in order) of a specific torrent
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-torrent-pieces-hashes}
     */
    async torrentPieceHashes(hash) {
        const res = await this.request('/torrents/pieceHashes', 'GET', { hash });
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-torrent-location}
     */
    async setTorrentLocation(hashes, location) {
        await this.request('/torrents/setLocation', 'POST', undefined, undefined, {
            location,
            hashes: this._normalizeHashes(hashes),
        });
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-torrent-name}
     */
    async setTorrentName(hash, name) {
        await this.request('/torrents/rename', 'POST', undefined, undefined, {
            hash,
            name,
        });
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-all-tags}
     */
    async getTags() {
        const res = await this.request('/torrents/tags', 'get');
        return res.body;
    }
    /**
     * @param tags comma separated list
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#create-tags}
     */
    async createTags(tags) {
        await this.request('/torrents/createTags', 'POST', undefined, undefined, {
            tags,
        }, undefined, false);
        return true;
    }
    /**
     * @param tags comma separated list
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#delete-tags}
     */
    async deleteTags(tags) {
        await this.request('/torrents/deleteTags', 'POST', undefined, undefined, { tags }, undefined, false);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#get-all-categories}
     */
    async getCategories() {
        const res = await this.request('/torrents/categories', 'get');
        return res.body;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#add-new-category}
     */
    async createCategory(category, savePath = '') {
        await this.request('/torrents/createCategory', 'POST', undefined, undefined, {
            category,
            savePath,
        }, undefined, false);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#edit-category}
     */
    async editCategory(category, savePath = '') {
        await this.request('/torrents/editCategory', 'POST', undefined, undefined, {
            category,
            savePath,
        }, undefined, false);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#remove-categories}
     */
    async removeCategory(categories) {
        await this.request('/torrents/removeCategories', 'POST', undefined, undefined, {
            categories,
        }, undefined, false);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#add-torrent-tags}
     */
    async addTorrentTags(hashes, tags) {
        await this.request('/torrents/addTags', 'POST', undefined, undefined, {
            hashes: this._normalizeHashes(hashes),
            tags,
        }, undefined, false);
        return true;
    }
    /**
     * if tags are not passed, removes all tags
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#remove-torrent-tags}
     */
    async removeTorrentTags(hashes, tags) {
        const form: any = { hashes: this._normalizeHashes(hashes) };
        if (tags) {
            form.tags = tags;
        }
        await this.request('/torrents/removeTags', 'POST', undefined, undefined, form, undefined, false);
        return true;
    }
    /**
     * helper function to remove torrent category
     */
    async resetTorrentCategory(hashes) {
        return this.setTorrentCategory(hashes);
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#set-torrent-category}
     */
    async setTorrentCategory(hashes, category = '') {
        await this.request('/torrents/setCategory', 'POST', undefined, undefined, {
            hashes: this._normalizeHashes(hashes),
            category,
        });
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#pause-torrents}
     */
    async pauseTorrent(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/pause', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#resume-torrents}
     */
    async resumeTorrent(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/resume', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#delete-torrents}
     */
    async removeTorrent(hashes, deleteFiles = true) {
        const params = {
            hashes: this._normalizeHashes(hashes),
            deleteFiles,
        };
        await this.request('/torrents/delete', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#recheck-torrents}
     */
    async recheckTorrent(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/recheck', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#reannounce-torrents}
     */
    async reannounceTorrent(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/reannounce', 'GET', params);
        return true;
    }
    async addTorrent(torrent, options: any = {}) {
        const form = new formdata_node_1.FormData();
        // remove options.filename, not used in form
        if (options.filename) {
            delete options.filename;
        }
        const type = { type: 'application/x-bittorrent' };
        if (typeof torrent === 'string') {
            if (fs_1.existsSync(torrent)) {
                const file = await file_from_path_1.fileFromPath(torrent, options.filename ?? 'torrent', type);
                form.set('file', file);
            }
            else {
                form.set('file', new formdata_node_1.File([Buffer.from(torrent, 'base64')], 'file.torrent', type));
            }
        }
        else {
            const file = new formdata_node_1.File([torrent], options.filename ?? 'torrent', type);
            form.set('file', file);
        }
        if (options) {
            // disable savepath when autoTMM is defined
            if (options.useAutoTMM === 'true') {
                options.savepath = '';
            }
            else {
                options.useAutoTMM = 'false';
            }
            for (const [key, value] of Object.entries(options)) {
                form.append(key, value);
            }
        }
        const res = await this.request('/torrents/add', 'POST', undefined, form, undefined, undefined, false);
        if (res.body === 'Fails.') {
            throw new Error('Failed to add torrent');
        }
        return true;
    }
    /**
     * @param hash Hash for desired torrent
     * @param id id of the file to be renamed
     * @param name new name to be assigned to the file
     */
    async renameFile(hash, id, name) {
        const form = new formdata_node_1.FormData();
        form.append('hash', hash);
        form.append('id', id);
        form.append('name', name);
        await this.request('/torrents/renameFile', 'POST', undefined, form, undefined, false);
        return true;
    }
    /**
     * @param urls URLs separated with newlines
     * @param options
     */
    async addMagnet(urls, options: any = {}) {
        const form = new formdata_node_1.FormData();
        form.append('urls', urls);
        if (options) {
            // disable savepath when autoTMM is defined
            if (options.useAutoTMM === 'true') {
                options.savepath = '';
            }
            else {
                options.useAutoTMM = 'false';
            }
            for (const [key, value] of Object.entries(options)) {
                form.append(key, value);
            }
        }
        const res = await this.request('/torrents/add', 'POST', undefined, form, undefined, undefined, false);
        if (res.body === 'Fails.') {
            throw new Error('Failed to add torrent');
        }
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#add-trackers-to-torrent}
     */
    async addTrackers(hash, urls) {
        const params = { hash, urls };
        await this.request('/torrents/addTrackers', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#edit-trackers}
     */
    async editTrackers(hash, origUrl, newUrl) {
        const params = { hash, origUrl, newUrl };
        await this.request('/torrents/editTrackers', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#remove-trackers}
     */
    async removeTrackers(hash, urls) {
        const params = { hash, urls };
        await this.request('/torrents/editTrackers', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#increase-torrent-priority}
     */
    async queueUp(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/increasePrio', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#decrease-torrent-priority}
     */
    async queueDown(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/decreasePrio', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#maximal-torrent-priority}
     */
    async topPriority(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/topPrio', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#minimal-torrent-priority}
     */
    async bottomPriority(hashes) {
        const params = {
            hashes: this._normalizeHashes(hashes),
        };
        await this.request('/torrents/bottomPrio', 'GET', params);
        return true;
    }
    /**
     * {@link https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)#login}
     */
    _sid: any
    _exp: any
    async login() {
        const url = pathLib.join(this.config.baseUrl, this.config.path, '/auth/login');
        const got = await import('got');
        const res = await got.got({
            url,
            method: 'POST',
            form: {
                username: this.config.username ?? '',
                password: this.config.password ?? '',
            },
            followRedirect: false,
            retry: { limit: 0 },
            timeout: { request: this.config.timeout },
            // allow proxy agent
            ...(this.config.agent ? { agent: this.config.agent } : {}),
        });
        if (!res.headers['set-cookie'] || !res.headers['set-cookie'].length) {
            throw new Error('Cookie not found. Auth Failed.');
        }
        const cookie = tough_cookie_1.Cookie.parse(res.headers['set-cookie'][0]);
        if (!cookie || cookie.key !== 'SID') {
            throw new Error('Invalid cookie');
        }
        this._sid = cookie.value;
        this._exp = cookie.expiryDate();
        return true;
    }
    logout() {
        this._sid = undefined;
        this._exp = undefined;
        return true;
    }
    async request(path, method, params = {}, body = undefined, form = undefined, headers = {}, json = true) {
        if (!this._sid || !this._exp || this._exp.getTime() < new Date().getTime()) {
            const authed = await this.login();
            if (!authed) {
                throw new Error('Auth Failed');
            }
        }
        const url = pathLib.join(this.config.baseUrl, this.config.path, path);
        const got = await import('got');
        const res = await got.got(url, {
            isStream: false,
            resolveBodyOnly: false,
            method,
            headers: {
                Cookie: `SID=${this._sid ?? ''}`,
                ...headers,
            },
            retry: { limit: 0 },
            body,
            form,
            searchParams: new url_1.URLSearchParams(params),
            // allow proxy agent
            timeout: { request: this.config.timeout },
            responseType: json ? 'json' : 'text',
            ...(this.config.agent ? { agent: this.config.agent } : {}),
        });
        return res;
    }
    /**
     * Normalizes hashes
     * @returns hashes as string seperated by `|`
     */
    _normalizeHashes(hashes) {
        if (Array.isArray(hashes)) {
            return hashes.join('|');
        }
        return hashes;
    }
    _normalizeTorrentData(torrent) {
        let state = NormalizedTorrentState.unknown;
        switch (torrent.state) {
            case types_1.TorrentState.ForcedDL:
            case types_1.TorrentState.MetaDL:
                state = NormalizedTorrentState.downloading;
                break;
            case types_1.TorrentState.Allocating:
                // state = 'stalledDL';
                state = NormalizedTorrentState.queued;
                break;
            case types_1.TorrentState.ForcedUP:
                state = NormalizedTorrentState.seeding;
                break;
            case types_1.TorrentState.PausedDL:
                state = NormalizedTorrentState.paused;
                break;
            case types_1.TorrentState.PausedUP:
                // state = 'completed';
                state = NormalizedTorrentState.paused;
                break;
            case types_1.TorrentState.QueuedDL:
            case types_1.TorrentState.QueuedUP:
                state = NormalizedTorrentState.queued;
                break;
            case types_1.TorrentState.CheckingDL:
            case types_1.TorrentState.CheckingUP:
            case types_1.TorrentState.QueuedForChecking:
            case types_1.TorrentState.CheckingResumeData:
            case types_1.TorrentState.Moving:
                state = NormalizedTorrentState.checking;
                break;
            case types_1.TorrentState.Unknown:
            case types_1.TorrentState.MissingFiles:
                state = NormalizedTorrentState.error;
                break;
            default:
                break;
        }
        const isCompleted = torrent.progress === 1;
        const result = {
            id: torrent.hash,
            name: torrent.name,
            stateMessage: '',
            state,
            dateAdded: new Date(torrent.added_on * 1000).toISOString(),
            isCompleted,
            progress: torrent.progress,
            label: torrent.category,
            dateCompleted: new Date(torrent.completion_on * 1000).toISOString(),
            savePath: torrent.save_path,
            uploadSpeed: torrent.upspeed,
            downloadSpeed: torrent.dlspeed,
            eta: torrent.eta,
            queuePosition: torrent.priority,
            connectedPeers: torrent.num_leechs,
            connectedSeeds: torrent.num_seeds,
            totalPeers: torrent.num_incomplete,
            totalSeeds: torrent.num_complete,
            totalSelected: torrent.size,
            totalSize: torrent.total_size,
            totalUploaded: torrent.uploaded,
            totalDownloaded: torrent.downloaded,
            ratio: torrent.ratio,
        };
        return result;
    }
}
exports.QBittorrent = QBittorrent;
