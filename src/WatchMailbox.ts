'use strict';

import { type Filter, type ImapConfig } from './Config';
import { simpleParser } from 'mailparser';
import ImapIdleConnectionAndEvent from 'imap-idle-keep-connection';
import { Logger } from './Logger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import type Connection = require('node-imap');
import { writeFile, stat } from 'node:fs/promises';
import path from 'path';

/**
 * WatchMailbox
 */
export class WatchMailbox {
    boxOpened = false;
    imapConnected = false;
    imap: Connection | undefined;
    _logger: Logger;
    mailBox: Connection.Box | undefined;
    mailboxName: string;

    /**
     * Constructor.
     *
     * @param mailBoxName - name of the mailbox to watch
     */
    constructor(mailBoxName = 'INBOX') {
        this._logger = Logger.getLogger({ name: this.constructor.name });
        this.mailboxName = mailBoxName;
    }

    /**
     * Add our flag to message
     *
     * @param uid message uid (from fetch)
     * @param filter filter to use
     */
    async addFlag(uid: number, filter: Filter): Promise<void> {
        return new Promise((resolve, reject) => {
            this._logger.debug(`Adding flag to message ${uid}`);
            //this.imap!._enqueue(`UID STORE ${uid} +FLAGS (attachmentsaved)`, true, (err: Error, result: any) => {
            this.imap!.addKeywords(uid, ['AttachmentSaved'], err => {
                if (err) {
                    this._logger.error('Error adding flag:', err);
                    reject(err);
                } else {
                    this._logger.debug(`${filter.name}: Added flag to message ${uid}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Move message to another mailbox
     *
     * @param uid message uid (from fetch)
     * @param filter filter to use
     */
    async moveMail(uid: number, filter: Filter): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.imapConnected) {
                if (filter.mailBoxDone) {
                    this._logger.debug(`Moving message ${uid} to ${filter.mailBoxDone}`);
                    this.imap!.move(uid, filter.mailBoxDone, err => {
                        if (err) {
                            this._logger.error('Error moving message:', err);
                            reject(err);
                        } else {
                            this._logger.debug(`${filter.name}: Moved message ${uid} to ${filter.mailBoxDone}`);
                            resolve();
                        }
                    });
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    }

    /**
     * Process all messages that were found by search
     * Will download messages and store attachments to filesystem.
     * Will then flag the message as processed.
     *
     * @param filter - filter to use, including path and rules to store files to.
     * @param uid - uid of the message to process (found by search)
     */
    async processFilteredMessage(filter: Filter, uid: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const fetch = this.imap!.fetch([uid], { bodies: '', struct: true });

            fetch.on('message', msg => {
                this._logger.debug(`${filter.name}: Processing message ${uid}`);

                let buffer = '';
                msg.on('body', stream => {
                    stream.on('data', chunk => {
                        buffer += chunk.toString('utf8');
                    });
                });

                msg.on('end', async () => {
                    this._logger.debug(`${filter.name}: Message complete`);
                    const parsed = await simpleParser(buffer);
                    this._logger.debug(`${filter.name}: Message has`, parsed.attachments.length, 'attachments');

                    if (parsed.attachments.length > 0) {
                        for (const attachment of parsed.attachments) {
                            let filename = attachment.filename || 'unknown';
                            if (filter.filterFilename) {
                                if (!attachment.filename || !attachment.filename.includes(filter.filterFilename)) {
                                    this._logger.debug(`${filter.name}: Skipping attachment:`, attachment.filename);
                                    continue;
                                }
                            }
                            if (filter.renameRule && filter.renameRule.includes('%')) {
                                parsed.date = parsed.date || new Date();
                                filename = filter.renameRule.replace(/%YEAR%/gi, String(parsed.date.getFullYear()));
                                filename = filename.replace(
                                    /%MONTH%/gi,
                                    `${parsed.date.getMonth() < 9 ? '0' : ''}${parsed.date.getMonth() + 1}`,
                                );
                                filename = filename.replace(
                                    /%DAY%/gi,
                                    `${parsed.date.getDate() < 10 ? '0' : ''}${parsed.date.getDate()}`,
                                );
                                filename = filename.replace(/%NAME%/gi, attachment.filename || 'unknown');
                            }
                            const filePath = path.join(filter.path, filename);
                            const stats = await stat(filePath).catch(() => null);
                            if (stats) {
                                this._logger.warn(`${filter.name}: File already exists: ${filename}`);
                            } else {
                                await writeFile(filePath, attachment.content);
                                await this.addFlag(uid, filter);
                                await this.moveMail(uid, filter); //maybe move.
                                this._logger.debug(`${filter.name}: Saved ${filename}`);
                            }
                            resolve();
                        }
                    } else {
                        this._logger.info(`${filter.name}: No attachments found.`);
                    }
                });
            });

            fetch.on('error', err => {
                this._logger.error('Error fetching message:', err);
                reject(err);
            });

            fetch.on('end', () => {
                this._logger.debug(`${filter.name}: Done fetching message`);
            });
        });
    }

    /**
     * Search messages that match the filter and where not yet processed.
     *
     * @param filter - filter to use
     */
    searchMessage(filter: Filter): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.imapConnected) {
                const rules = [['!KEYWORD', 'ATTACHMENTSAVED']].concat(filter.rules as string[]);
                this._logger.debug('Searching messages with rules:', rules);
                this.imap!.search(rules, async (err, results) => {
                    if (err) {
                        this._logger.error('Error searching messages:', err, err.stack);
                        reject(err);
                    } else {
                        try {
                            this._logger.debug('Found messages:', results);
                            for (const uid of results) {
                                await this.processFilteredMessage(filter, uid);
                            }
                            resolve();
                        } catch (e: any) {
                            if (e instanceof Error) {
                                this._logger.error('Error processing message:', e, e.stack);
                                reject(e);
                            } else {
                                this._logger.error('Error processing message:', e);
                                reject(new Error(e));
                            }
                        }
                    }
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Search messages for each filter and process them.
     *
     * @param filters array of filters to use
     */
    async searchAllMessages(filters: Filter[]): Promise<void> {
        for (const filter of filters) {
            if (
                filter.mailBoxToWatch === this.mailboxName ||
                (!filter.mailBoxToWatch && this.mailboxName === 'INBOX')
            ) {
                await this.searchMessage(filter);
            }
        }
    }

    /**
     * watch mailbox for new mails and process them using filters.
     *
     * @param imapConfig - imap configuration
     * @param filters - filters to use
     */
    async watchMailbox(imapConfig: ImapConfig, filters: Filter[]): Promise<void> {
        return new Promise((resolve, reject) => {
            this._logger.debug('Watching mailbox:', this.mailboxName);
            const settings = { ...imapConfig, mailbox: this.mailboxName };
            const watcher = new ImapIdleConnectionAndEvent(settings);
            watcher.on('box', async (box: any) => {
                this._logger.debug('box', box.name, 'opened for', this.mailboxName);
                this.mailBox = box;
                this.boxOpened = true;
                this.imap!.search([['KEYWORD', 'ATTACHMENTSAVED']], (err, results) => {
                    if (err) {
                        this._logger.error('Error searching messages:', err, err.stack);
                        reject(err);
                    } else {
                        this._logger.debug('Found messages already processed:', results);
                    }
                });
                await this.searchAllMessages(filters);
            });
            watcher.on('mail', async (imapIn, numNewMessages) => {
                this._logger.info(`${numNewMessages} new messages, processing filters.`);
                //yay, new mail, let's check!
                this.imap = imapIn || watcher;
                await this.searchAllMessages(filters);
            });
            watcher.on('error', (err: any) => {
                this._logger.error('Something went really wrong: ', err);
                this.boxOpened = false;
                this.imapConnected = false;
                if (err instanceof Error) {
                    reject(err);
                } else {
                    reject(new Error(err));
                }
            });
            watcher.on('end', () => {
                this._logger.debug('Connection ended.');
                this.boxOpened = false;
                this.imapConnected = false;
                resolve();
            });
            watcher.on('ready', imapIn => {
                this.imap = imapIn || watcher;
                this.imapConnected = true;
                this._logger.debug('imap connection ready');
            });
        });
    }
}
