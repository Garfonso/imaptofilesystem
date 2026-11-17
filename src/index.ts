'use strict';

import { Config } from './Config';
import { Logger } from './Logger';
import { WatchMailbox } from './WatchMailbox';

/**
 * ImapToFilesystem
 */
export class ImapToFilesystem {
    config: Config;
    _logger: Logger;
    watchers: WatchMailbox[] = [];

    /**
     * Constructor.
     */
    constructor() {
        this._logger = Logger.getLogger({ name: this.constructor.name });
        this.config = new Config();
    }

    /**
     * Main function.
     */
    async main(): Promise<void> {
        await this.config.loadConfig();

        if (!this.config.imap) {
            this._logger.error('No imap configuration found.');
            return;
        }
        //recreate logger with config:
        Logger.setConfig(this.config.logger);
        this._logger = Logger.getLogger({ name: this.constructor.name });

        const mailboxes: string[] = [];
        for (const filter of this.config.filters) {
            if (!filter.disabled) {
                if (filter.mailBoxToWatch) {
                    if (!mailboxes.includes(filter.mailBoxToWatch)) {
                        mailboxes.push(filter.mailBoxToWatch);
                    }
                } else {
                    if (!mailboxes.includes('INBOX')) {
                        mailboxes.push('INBOX');
                    }
                }
            }
        }
        if (mailboxes.length === 0) {
            mailboxes.push('INBOX');
        }
        this._logger.info('Watching mailboxes:', mailboxes.join(', '));
        for (const mailbox of mailboxes) {
            const watcher = new WatchMailbox(mailbox, this.config.filters);
            this.watchers.push(watcher);
            watcher.start(this.config.imap);
        }
    }

    /**
     * Log out of all mailboxes.
     */
    async stop(): Promise<void> {
        await Promise.all(this.watchers.map(watcher => watcher.stop()));
    }
}

const app = new ImapToFilesystem();
app.main()
    .then(() => {
        console.log('Watcher setup.');
    })
    .catch(e => {
        console.error(e instanceof Error ? e.message : e);
        void Logger.close().finally(() => process.exit(1));
    });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
        const timeout = setTimeout(() => process.exit(1), 5000);
        timeout.unref();
        void app
            .stop()
            .finally(() => Logger.close())
            .finally(() => process.exit(0));
    });
}
