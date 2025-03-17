import path from 'path';
import { readFile, writeFile } from 'node:fs/promises';
import { Logger, type LoggerConfig } from './Logger';

/**
 * ConfigElement, defines a name and coordinates for a device.
 */
export class Filter {
    name: string;
    rules: Array<string | string[]>; // as in node-imap.SearchCriteria
    path: string;
    renameRule: string;
    mailBoxToWatch?: string;
    mailBoxDone?: string;
    filterFilename?: string;
    disabled?: boolean;

    /**
     * Constructor.
     *
     * @param name name of filter rule for easier reference
     * @param rules set of rules that have to apply
     * @param path path to move possible files to
     * @param renameRule rule to rename files
     * @param mailBoxToWatch mailbox to watch for mails
     * @param mailBoxDone mailbox to move done mails to
     * @param filterFilename filter for filename
     */
    constructor(
        name = 'Filter',
        rules: string[] = [],
        path = '.',
        renameRule = '',
        mailBoxToWatch?: string,
        mailBoxDone?: string,
        filterFilename?: string,
    ) {
        this.name = name;
        this.rules = rules;
        this.path = path;
        this.renameRule = renameRule;
        this.mailBoxToWatch = mailBoxToWatch;
        this.mailBoxDone = mailBoxDone;
        this.filterFilename = filterFilename;
    }
}

/**
 * ImapConfig, configuration for imap server.
 */
export class ImapConfig {
    name = 'imap';
    user = '';
    password = '';
    host = '';
    port = 993;
    tls = true;
    mailbox?: string;

    /**
     * Constructor.
     *
     * @param user username for imap server
     * @param password password for imap server
     * @param host host of imap server
     * @param port port of imap server
     * @param tls use tls for imap server
     */
    constructor(user = '', password = '', host = '', port = 993, tls = true) {
        this.user = user;
        this.password = password;
        this.host = host;
        this.port = port;
        this.tls = tls;
    }
}

/**
 * ConfigStore, holds configurations for devices and also allows to map serial to name.
 */
export class ConfigStore {
    imap: ImapConfig | undefined;
    filters: Filter[];
    logger?: LoggerConfig;

    /**
     * Constructor.
     *
     * @param [imapConfig] - imap configuration
     * @param [filters] - filters
     */
    constructor(imapConfig = new ImapConfig(), filters: Filter[] = []) {
        this.imap = imapConfig;
        this.filters = filters;
    }
}

/**
 * Config, loads and holds configuration for devices.
 */
export class Config {
    _logger: Logger;
    configStore: ConfigStore;

    /**
     * Constructor.
     */
    constructor() {
        this._logger = Logger.getLogger({ name: this.constructor.name });
        this.configStore = new ConfigStore();
    }

    /**
     * Load config from a file.
     *
     * @param [filepath] optional filepath
     */
    async loadConfig(filepath = ''): Promise<void> {
        if (filepath === '') {
            filepath = path.join(__dirname, '..', 'config.json');
        }
        try {
            const configContent = await readFile(filepath, 'utf-8');
            this.configStore = JSON.parse(configContent);
            if (this.configStore.logger) {
                Logger.setConfig(this.configStore.logger);
            }
            this._logger.debug('Config loaded:', this.configStore);
        } catch (e) {
            this._logger.error('Error loading config: ', e);
        }
    }

    /**
     * Store config to a file.
     *
     * @param [filepath] optional filepath
     */
    async storeConfig(filepath = ''): Promise<void> {
        if (filepath === '') {
            filepath = path.join(__dirname, '..', 'config.json');
        }
        try {
            await writeFile(filepath, JSON.stringify(this.configStore, null, 2));
            this._logger.debug('Config stored:', this.configStore);
        } catch (e) {
            this._logger.error('Error storing config: ', e);
        }
    }

    /**
     * get imap config
     */
    get imap(): ImapConfig | undefined {
        return this.configStore.imap;
    }

    /**
     * get filters
     */
    get filters(): Filter[] {
        return this.configStore.filters;
    }

    /**
     * get logger config
     */
    get logger(): LoggerConfig {
        return this.configStore.logger || { serverUrl: '', apiKey: '', debug: false, useConsole: true };
    }
}
