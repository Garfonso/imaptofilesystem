import { expect } from 'chai';
import type { SeqEvent } from 'seq-logging';
import { escapeTemplate, Logger, type SeqLike } from '../src/Logger';

describe('Logger', () => {
    const createSeq = Logger.createSeq;
    const consoleLog = console.log;
    let events: SeqEvent[];
    let created: number;
    let closed: number;
    let printed: unknown[][];

    beforeEach(() => {
        events = [];
        created = 0;
        closed = 0;
        printed = [];
        Logger.createSeq = async (): Promise<SeqLike> => {
            created += 1;
            return { emit: e => events.push(e), close: async () => { closed += 1; } };
        };
        console.log = (...args: unknown[]) => { printed.push(args); };
    });

    afterEach(async () => {
        console.log = consoleLog;
        await Logger.close();
        Logger.createSeq = createSeq;
        Logger.setConfig({});
    });

    it('sends nothing to Seq without useSeq', () => {
        Logger.setConfig({ serverUrl: 'http://localhost:5341', apiKey: 'key' });
        new Logger('a').info('hello');
        expect(created).to.equal(0);
        expect(printed).to.have.length(1);
    });

    it('shares one Seq connection, escapes the text, closes it', async () => {
        const early = new Logger('early'); // created before the config is loaded
        Logger.setConfig({ useSeq: true, debug: true });
        early.debug('debug', { a: 1 });
        new Logger('other').error('failed: {json}');
        await new Promise(resolve => setImmediate(resolve));
        expect(created).to.equal(1);
        expect(events.map(e => [e.level, e.messageTemplate, e.properties])).to.deep.equal([
            ['Debug', '{Logger} debug {{ a: 1 }}', { Logger: 'early' }],
            ['Error', '{Logger} failed: {{json}}', { Logger: 'other' }],
        ]);
        await Logger.close();
        expect(closed).to.equal(1);
    });

    it('respects useConsole: false and debug: false', () => {
        Logger.setConfig({ useConsole: false, debug: false });
        new Logger('a').info('hidden');
        new Logger('b', undefined, true).debug('no debug');
        expect(printed).to.deep.equal([]);
    });

    it('escapes template braces', () => {
        expect(escapeTemplate('{"a":{}}')).to.equal('{{"a":{{}}}}');
    });
});
