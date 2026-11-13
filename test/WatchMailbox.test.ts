import { expect } from 'chai';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'path';
import type { KeepConnectionOptions } from 'imap-idle-keep-connection';
import { Filter, ImapConfig } from '../src/Config';
import { PROCESSED_KEYWORD, saveAttachment, targetName, WatchMailbox, type MailClient } from '../src/WatchMailbox';

function mail(subject: string, attachments: Array<{ name: string; content: string }>): Buffer {
    const boundary = 'BOUNDARY';
    const parts = attachments.map(a => [
        `--${boundary}`,
        `Content-Type: application/pdf; name="${a.name}"`,
        `Content-Disposition: attachment; filename="${a.name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(a.content).toString('base64'),
    ].join('\r\n'));
    return Buffer.from([
        'From: shop@example.org',
        'To: me@example.org',
        `Subject: ${subject}`,
        'Date: Tue, 05 Mar 2024 10:00:00 +0100',
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain',
        '',
        'see attachment',
        ...parts,
        `--${boundary}--`,
        '',
    ].join('\r\n'));
}

/** fake imapflow client with messages by uid. */
class FakeClient implements MailClient {
    searches: unknown[] = [];
    flagged: string[] = [];
    moved: Array<[string, string]> = [];
    messages: Record<number, Buffer>;
    found: number[];

    constructor(messages: Record<number, Buffer>, found: number[]) {
        this.messages = messages;
        this.found = found;
    }

    search = (async (query: unknown) => {
        this.searches.push(query);
        return this.found;
    }) as MailClient['search'];

    fetchOne = (async (uid: string) => ({ uid: Number(uid), source: this.messages[Number(uid)] })) as unknown as MailClient['fetchOne'];

    messageFlagsAdd = (async (uid: string, flags: string[]) => {
        this.flagged.push(`${uid}:${flags.join(',')}`);
        return true;
    }) as MailClient['messageFlagsAdd'];

    messageMove = (async (uid: string, target: string) => {
        this.moved.push([uid, target]);
        return false;
    }) as unknown as MailClient['messageMove'];
}

function filter(props: Partial<Filter>): Filter {
    return Object.assign(new Filter('Shop'), props);
}

describe('WatchMailbox', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'imaptofilesystem-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('searches only unprocessed mails of the filters for this mailbox', async () => {
        const client = new FakeClient({}, []);
        const watcher = new WatchMailbox('IKV/Reflex', [
            filter({ name: 'a', search: { subject: 'Report' }, mailBoxToWatch: 'IKV/Reflex' }),
            filter({ name: 'b', search: { subject: 'Other' } }),
            filter({ name: 'c', search: { subject: 'Off' }, mailBoxToWatch: 'IKV/Reflex', disabled: true }),
        ]);
        await watcher.processAll(client);
        expect(client.searches).to.deep.equal([{ subject: 'Report', unKeyword: PROCESSED_KEYWORD }]);
    });

    it('saves matching attachments, then flags and moves the mail once', async () => {
        const client = new FakeClient({ 7: mail('Invoice', [{ name: 'invoice.pdf', content: 'PDF1' }, { name: 'terms.txt', content: 'T' }, { name: 'extra.pdf', content: 'PDF2' }]) }, [7]);
        const watcher = new WatchMailbox('INBOX', [filter({ path: dir, renameRule: '%YEAR%-%MONTH%-%DAY% %NAME%', filterFilename: '.pdf', mailBoxDone: 'Done' })]);
        await watcher.processAll(client);
        expect((await readdir(dir)).sort()).to.deep.equal(['2024-03-05 extra.pdf', '2024-03-05 invoice.pdf']);
        expect(await readFile(path.join(dir, '2024-03-05 invoice.pdf'), 'utf-8')).to.equal('PDF1');
        expect(client.flagged).to.deep.equal([`7:${PROCESSED_KEYWORD}`]);
        expect(client.moved).to.deep.equal([['7', 'Done']]);
    });

    it('marks mails without matching attachment as processed, without moving them (no hang)', async () => {
        const client = new FakeClient({ 3: mail('Invoice', [{ name: 'terms.txt', content: 'T' }]) }, [3]);
        const watcher = new WatchMailbox('INBOX', [filter({ path: dir, filterFilename: '.pdf', mailBoxDone: 'Done' })]);
        await watcher.processAll(client);
        expect(await readdir(dir)).to.deep.equal([]);
        expect(client.flagged).to.deep.equal([`3:${PROCESSED_KEYWORD}`]);
        expect(client.moved).to.deep.equal([]);
    });

    it('only flags and moves without path', async () => {
        const client = new FakeClient({}, [1, 2]);
        const watcher = new WatchMailbox('INBOX', [filter({ path: '', mailBoxDone: 'Done' })]);
        await watcher.processAll(client);
        expect(client.flagged).to.deep.equal([`1:${PROCESSED_KEYWORD}`, `2:${PROCESSED_KEYWORD}`]);
        expect(client.moved).to.deep.equal([['1', 'Done'], ['2', 'Done']]);
    });

    it('goes on with the next mail if one fails', async () => {
        const client = new FakeClient({ 2: mail('ok', [{ name: 'a.pdf', content: 'A' }]) }, [1, 2]); // 1 can't be fetched
        const watcher = new WatchMailbox('INBOX', [filter({ path: dir })]);
        await watcher.processAll(client);
        expect(await readdir(dir)).to.deep.equal(['a.pdf']);
        expect(client.flagged).to.deep.equal([`2:${PROCESSED_KEYWORD}`]);
    });

    it('connects with the imap config, processes on ready and new mail, one run at a time', async () => {
        const client = new FakeClient({}, []);
        let options: KeepConnectionOptions | undefined;
        let release: (() => void) | undefined;
        const connection = Object.assign(new EventEmitter(), {
            start() {},
            async stop() {},
            async withMailbox<T>(fn: (c: never) => Promise<T>): Promise<T> {
                await new Promise<void>(resolve => { release = resolve; });
                return fn(client as never);
            },
        });
        const watcher = new WatchMailbox('INBOX', [filter({ search: { from: 'x' } })]);
        const config = Object.assign(new ImapConfig('me', 'pw', 'imap.example.org'), { port: '993' as unknown as number });
        watcher.start(config, o => { options = o; return connection; });
        expect(options).to.include({ host: 'imap.example.org', port: 993, secure: true, mailbox: 'INBOX' });
        expect(options?.credentials).to.deep.equal({ user: 'me', password: 'pw' });

        connection.emit('ready');
        connection.emit('mail', { count: 2, prevCount: 1 });
        connection.emit('mail', { count: 3, prevCount: 2 });
        for (let i = 0; i < 3; i += 1) {
            await new Promise(resolve => setImmediate(resolve));
            release?.();
            release = undefined;
        }
        await new Promise(resolve => setImmediate(resolve));
        expect(client.searches).to.have.length(2, 'first run + one rerun for both mails');
        await watcher.stop();
    });
});

describe('targetName / saveAttachment', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'imaptofilesystem-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('applies the rename rule', () => {
        const date = new Date(2024, 0, 9);
        expect(targetName('%YEAR%-%MONTH%-%DAY% Rechnung %name%', 'a.pdf', date)).to.equal('2024-01-09 Rechnung a.pdf');
        expect(targetName('no placeholder', 'a.pdf', date)).to.equal('a.pdf');
        expect(targetName(undefined, undefined, date)).to.equal('unknown');
    });

    it('never overwrites, skips identical files', async () => {
        const file = path.join(dir, 'invoice.pdf');
        expect(await saveAttachment(file, Buffer.from('one'))).to.equal(file);
        expect(await saveAttachment(file, Buffer.from('one'))).to.equal(undefined);
        expect(await saveAttachment(file, Buffer.from('two'))).to.equal(path.join(dir, 'invoice (2).pdf'));
        expect(await saveAttachment(file, Buffer.from('two'))).to.equal(undefined);
        await writeFile(path.join(dir, 'invoice (3).pdf'), 'other');
        expect(await saveAttachment(file, Buffer.from('three'))).to.equal(path.join(dir, 'invoice (4).pdf'));
        expect(await readFile(file, 'utf-8')).to.equal('one');
    });
});
