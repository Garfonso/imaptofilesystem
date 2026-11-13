'use strict';

import path from 'path';
import { readFile, writeFile } from 'node:fs/promises';
import { simpleParser } from 'mailparser';
import { KeepConnection, type ImapFlow, type KeepConnectionOptions, type MailInfo } from 'imap-idle-keep-connection';
import { type Filter, type ImapConfig } from './Config';
import { Logger } from './Logger';

/** keyword set on processed messages, they are not searched again. */
export const PROCESSED_KEYWORD = 'AttachmentSaved';

/** the parts of KeepConnection we use. */
export interface MailboxConnection {
    /** connected (again), mailbox selected */
    on(event: 'ready', listener: () => void): unknown;
    /** new messages */
    on(event: 'mail', listener: (info: MailInfo) => void): unknown;
    /** connect, keeps reconnecting */
    start(): void;
    /** log out */
    stop(): Promise<void>;
    /** run fn with the mailbox locked */
    withMailbox<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T>;
}

export type ConnectionFactory = (options: KeepConnectionOptions) => MailboxConnection;

/** the parts of ImapFlow we use. */
export type MailClient = Pick<ImapFlow, 'search' | 'fetchOne' | 'messageFlagsAdd' | 'messageMove'>;

/**
 * File name for an attachment: renameRule with %YEAR%, %MONTH%, %DAY% (of the mail) and
 * %NAME% (original file name), or the original name if the rule has no placeholder.
 *
 * @param renameRule - rule from the filter
 * @param filename - name of the attachment
 * @param date - date of the mail
 */
export function targetName(renameRule: string | undefined, filename: string | undefined, date: Date): string {
    const name = filename || 'unknown';
    if (!renameRule || !renameRule.includes('%')) {
        return name;
    }
    return renameRule
        .replace(/%YEAR%/gi, String(date.getFullYear()))
        .replace(/%MONTH%/gi, String(date.getMonth() + 1).padStart(2, '0'))
        .replace(/%DAY%/gi, String(date.getDate()).padStart(2, '0'))
        .replace(/%NAME%/gi, name);
}

/**
 * Write content to file, never overwrite: if a different file with that name exists,
 * use "name (2).ext", "name (3).ext", ...
 *
 * @param file - wanted file name
 * @param content - attachment content
 * @returns the file written, undefined if a file with the same content exists already
 */
export async function saveAttachment(file: string, content: Buffer): Promise<string | undefined> {
    const { dir, name, ext } = path.parse(file);
    for (let n = 1; ; n += 1) {
        const candidate = n === 1 ? file : path.join(dir, `${name} (${n})${ext}`);
        let existing: Buffer;
        try {
            existing = await readFile(candidate);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw e;
            }
            await writeFile(candidate, content, { flag: 'wx' });
            return candidate;
        }
        if (existing.equals(content)) {
            return undefined;
        }
    }
}

/**
 * Watches one mailbox and stores attachments of mails matching the filters.
 */
export class WatchMailbox {
    readonly mailboxName: string;
    _logger: Logger;
    #filters: Filter[];
    #connection: MailboxConnection | undefined;
    #running = false;
    #rerun = false;

    /**
     * Constructor.
     *
     * @param mailBoxName - name of the mailbox to watch
     * @param filters - all filters, only those for this mailbox are used
     */
    constructor(mailBoxName = 'INBOX', filters: Filter[] = []) {
        this._logger = Logger.getLogger({ name: `${this.constructor.name} ${mailBoxName}` });
        this.mailboxName = mailBoxName;
        this.#filters = filters;
    }

    /**
     * enabled filters for this mailbox.
     */
    get filters(): Filter[] {
        return this.#filters.filter(
            filter => !filter.disabled && (filter.mailBoxToWatch || 'INBOX') === this.mailboxName,
        );
    }

    /**
     * Connect and process mails whenever connected and on new mails.
     *
     * @param imapConfig - imap configuration
     * @param createConnection - for tests
     */
    start(imapConfig: ImapConfig, createConnection: ConnectionFactory = options => new KeepConnection(options)): void {
        const connection = createConnection({
            host: imapConfig.host,
            port: Number(imapConfig.port),
            secure: imapConfig.tls !== false,
            mailbox: this.mailboxName,
            credentials: { user: imapConfig.user, password: imapConfig.password },
            logger: this._logger,
        });
        connection.on('ready', () => void this.process('connected'));
        connection.on('mail', info => void this.process(`${info.count - info.prevCount} new messages`));
        this.#connection = connection;
        connection.start();
    }

    /**
     * Log out.
     */
    async stop(): Promise<void> {
        const connection = this.#connection;
        this.#connection = undefined;
        await connection?.stop();
    }

    /**
     * Search and process messages of all filters. If called while running, runs once more afterwards.
     *
     * @param reason - for the log
     */
    async process(reason: string): Promise<void> {
        const connection = this.#connection;
        if (!connection) {
            return;
        }
        if (this.#running) {
            this.#rerun = true;
            return;
        }
        this.#running = true;
        try {
            do {
                this.#rerun = false;
                this._logger.debug(`Processing filters (${reason}).`);
                await connection.withMailbox(client => this.processAll(client));
            } while (this.#rerun);
        } catch (e) {
            this._logger.error('Processing failed:', (e as Error).message);
        } finally {
            this.#running = false;
        }
    }

    /**
     * Search messages of all filters that were not processed yet and process them.
     *
     * @param client - imap client, mailbox selected
     */
    async processAll(client: MailClient): Promise<void> {
        for (const filter of this.filters) {
            const uids = await client.search({ ...filter.search, unKeyword: PROCESSED_KEYWORD }, { uid: true });
            if (!uids || uids.length === 0) {
                continue;
            }
            this._logger.debug(`${filter.name}: found messages`, uids);
            for (const uid of uids) {
                try {
                    await this.processMessage(client, filter, uid);
                } catch (e) {
                    this._logger.error(`${filter.name}: message ${uid} failed:`, (e as Error).message);
                }
            }
        }
    }

    /**
     * Store the attachments of one message, mark it as processed and move it.
     *
     * @param client - imap client, mailbox selected
     * @param filter - filter that found the message
     * @param uid - message uid
     */
    async processMessage(client: MailClient, filter: Filter, uid: number): Promise<void> {
        if (!filter.path) {
            this._logger.debug(`${filter.name}: no path, just flagging and moving message ${uid}`);
            await this.markProcessed(client, filter, uid, true);
            return;
        }
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) {
            throw new Error('could not fetch the message');
        }
        const parsed = await simpleParser(message.source);
        const date = parsed.date || new Date();
        const attachments = parsed.attachments.filter(
            attachment => !filter.filterFilename || !!attachment.filename?.includes(filter.filterFilename),
        );
        if (attachments.length === 0) {
            this._logger.info(`${filter.name}: no matching attachment in "${parsed.subject}", marked as processed.`);
            await this.markProcessed(client, filter, uid, false);
            return;
        }
        for (const attachment of attachments) {
            const file = path.join(filter.path, targetName(filter.renameRule, attachment.filename, date));
            const saved = await saveAttachment(file, attachment.content);
            if (saved) {
                this._logger.info(`${filter.name}: saved ${saved}`);
            } else {
                this._logger.debug(`${filter.name}: ${file} exists with the same content.`);
            }
        }
        await this.markProcessed(client, filter, uid, true);
    }

    /**
     * Set the processed keyword and move the message to filter.mailBoxDone.
     *
     * @param client - imap client
     * @param filter - filter
     * @param uid - message uid
     * @param move - move to mailBoxDone (if configured)
     */
    async markProcessed(client: MailClient, filter: Filter, uid: number, move: boolean): Promise<void> {
        await client.messageFlagsAdd(String(uid), [PROCESSED_KEYWORD], { uid: true });
        if (move && filter.mailBoxDone) {
            await client.messageMove(String(uid), filter.mailBoxDone, { uid: true });
            this._logger.debug(`${filter.name}: moved message ${uid} to ${filter.mailBoxDone}`);
        }
    }
}
