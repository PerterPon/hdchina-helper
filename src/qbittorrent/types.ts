"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentPieceState = exports.TorrentFilePriority = exports.TorrentTrackerStatus = exports.TorrentState = void 0;
(function (TorrentState) {
    /**
     * Some error occurred, applies to paused torrents
     */
    TorrentState["Error"] = "error";
    /**
     * Torrent is paused and has finished downloading
     */
    TorrentState["PausedUP"] = "pausedUP";
    /**
     * Torrent is paused and has NOT finished downloading
     */
    TorrentState["PausedDL"] = "pausedDL";
    /**
     * Queuing is enabled and torrent is queued for upload
     */
    TorrentState["QueuedUP"] = "queuedUP";
    /**
     * Queuing is enabled and torrent is queued for download
     */
    TorrentState["QueuedDL"] = "queuedDL";
    /**
     * Torrent is being seeded and data is being transferred
     */
    TorrentState["Uploading"] = "uploading";
    /**
     * Torrent is being seeded, but no connection were made
     */
    TorrentState["StalledUP"] = "stalledUP";
    /**
     * Torrent has finished downloading and is being checked; this status also applies to preallocation (if enabled) and checking resume data on qBt startup
     */
    TorrentState["CheckingUP"] = "checkingUP";
    /**
     * Same as checkingUP, but torrent has NOT finished downloading
     */
    TorrentState["CheckingDL"] = "checkingDL";
    /**
     * Torrent is being downloaded and data is being transferred
     */
    TorrentState["Downloading"] = "downloading";
    /**
     * Torrent is being downloaded, but no connection were made
     */
    TorrentState["StalledDL"] = "stalledDL";
    /**
     * Torrent is forced to downloading to ignore queue limit
     */
    TorrentState["ForcedDL"] = "forcedDL";
    /**
     * Torrent is forced to uploading and ignore queue limit
     */
    TorrentState["ForcedUP"] = "forcedUP";
    /**
     * Torrent has just started downloading and is fetching metadata
     */
    TorrentState["MetaDL"] = "metaDL";
    /**
     * Torrent is allocating disk space for download
     */
    TorrentState["Allocating"] = "allocating";
    TorrentState["QueuedForChecking"] = "queuedForChecking";
    /**
     * Checking resume data on qBt startup
     */
    TorrentState["CheckingResumeData"] = "checkingResumeData";
    /**
     * Torrent is moving to another location
     */
    TorrentState["Moving"] = "moving";
    /**
     * Unknown status
     */
    TorrentState["Unknown"] = "unknown";
    /**
     * Torrent data files is missing
     */
    TorrentState["MissingFiles"] = "missingFiles";
})(exports.TorrentState = exports.TorrentState || (exports.TorrentState = {}));
(function (TorrentTrackerStatus) {
    /**
     * Tracker is disabled (used for DHT, PeX, and LSD)
     */
    TorrentTrackerStatus[TorrentTrackerStatus["Disabled"] = 0] = "Disabled";
    /**
     * Tracker has been contacted and is working
     */
    TorrentTrackerStatus[TorrentTrackerStatus["Working"] = 1] = "Working";
    /**
     * Tracker is currently being updated
     */
    TorrentTrackerStatus[TorrentTrackerStatus["Updating"] = 2] = "Updating";
    /**
     * Tracker has been contacted, but it is not working (or doesn't send proper replies)
     */
    TorrentTrackerStatus[TorrentTrackerStatus["Errored"] = 3] = "Errored";
    /**
     * Tracker has not been contacted yet
     */
    TorrentTrackerStatus[TorrentTrackerStatus["Waiting"] = 4] = "Waiting";
})(exports.TorrentTrackerStatus = exports.TorrentTrackerStatus || (exports.TorrentTrackerStatus = {}));
(function (TorrentFilePriority) {
    /**
     * Do not download
     */
    TorrentFilePriority[TorrentFilePriority["Skip"] = 0] = "Skip";
    /**
     * Normal priority
     */
    TorrentFilePriority[TorrentFilePriority["NormalPriority"] = 1] = "NormalPriority";
    /**
     * High priority
     */
    TorrentFilePriority[TorrentFilePriority["HighPriority"] = 6] = "HighPriority";
    /**
     * Maximal priority
     */
    TorrentFilePriority[TorrentFilePriority["MaxPriority"] = 7] = "MaxPriority";
})(exports.TorrentFilePriority = exports.TorrentFilePriority || (exports.TorrentFilePriority = {}));
(function (TorrentPieceState) {
    /**
     * Not downloaded yet
     */
    TorrentPieceState[TorrentPieceState["NotDownloaded"] = 0] = "NotDownloaded";
    /**
     * Now downloading
     */
    TorrentPieceState[TorrentPieceState["Requested"] = 1] = "Requested";
    /**
     * Already downloaded
     */
    TorrentPieceState[TorrentPieceState["Downloaded"] = 2] = "Downloaded";
})(exports.TorrentPieceState = exports.TorrentPieceState || (exports.TorrentPieceState = {}));
