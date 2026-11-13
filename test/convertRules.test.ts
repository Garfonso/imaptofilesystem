import { expect } from 'chai';
import { convertRules } from '../src/convertRules';
import { convertConfig } from '../src/convertConfig';
import { validateFilters, type Filter } from '../src/Config';

describe('convertRules', () => {
    it('converts flags and string criteria into one object', () => {
        expect(convertRules([['UNSEEN'], ['FROM', 'shop.example'], ['SUBJECT', 'Invoice'], ['TO', 'me@example.org']])).to.deep.equal({
            seen: false,
            from: 'shop.example',
            subject: 'Invoice',
            to: 'me@example.org',
        });
        expect(convertRules(['SEEN', 'FLAGGED'])).to.deep.equal({ seen: true, flagged: true });
    });

    it('flattens nested ORs', () => {
        const rules = [
            ['UNSEEN'],
            ['OR', ['OR', ['SUBJECT', 'Monatsbericht'], ['SUBJECT', 'Monthly Report']], ['OR', ['SUBJECT', 'Monats Bericht'], ['SUBJECT', 'Monatsreport']]],
        ];
        expect(convertRules(rules)).to.deep.equal({
            seen: false,
            or: [{ subject: 'Monatsbericht' }, { subject: 'Monthly Report' }, { subject: 'Monats Bericht' }, { subject: 'Monatsreport' }],
        });
        expect(convertRules([['OR', ['FROM', 'a'], ['UNSEEN']]])).to.deep.equal({ or: [{ from: 'a' }, { seen: false }] });
    });

    it('converts negation, dates, sizes and headers', () => {
        expect(convertRules([['!FROM', 'spam'], ['SINCE', 'May 20, 2024'], ['LARGER', '1000'], ['HEADER', 'X-Tag', 'a'], ['HEADER', 'X-Other', 'b']])).to.deep.equal({
            not: { from: 'spam' },
            since: 'May 20, 2024',
            larger: 1000,
            header: { 'X-Tag': 'a', 'X-Other': 'b' },
        });
        expect(convertRules([['NOT', ['SUBJECT', 'x']]])).to.deep.equal({ not: { subject: 'x' } });
    });

    it('refuses what it can not express', () => {
        expect(() => convertRules([['SUBJECT', 'a'], ['SUBJECT', 'b']])).to.throw(/conflicts with an earlier rule/);
        expect(() => convertRules([['!FROM', 'a'], ['!TO', 'b']])).to.throw(/conflicts/);
        expect(() => convertRules([['X-GM-RAW', 'has:attachment']])).to.throw(/convert "X-GM-RAW" by hand/);
        expect(() => convertRules([['OR', ['FROM', 'a']]])).to.throw(/OR needs two criteria/);
    });
});

describe('convertConfig', () => {
    it('replaces rules by search and keeps everything else', () => {
        const config = {
            imap: { user: 'u' },
            filters: [
                { name: 'a', rules: [['UNSEEN'], ['SUBJECT', 'Report']], path: '/x', mailBoxToWatch: 'IKV/Reflex' },
                { name: 'b', search: { from: 'x' } },
            ],
        };
        expect(convertConfig(config)).to.equal(1);
        expect(config.filters[0]).to.deep.equal({ name: 'a', search: { seen: false, subject: 'Report' }, path: '/x', mailBoxToWatch: 'IKV/Reflex' });
        expect(config.filters[1]).to.deep.equal({ name: 'b', search: { from: 'x' } });
        expect(convertConfig(config)).to.equal(0, 'second run: nothing to do');
    });

    it('names the filter on errors', () => {
        expect(() => convertConfig({ filters: [{ name: 'bad', rules: [['SUBJECT', 'a'], ['SUBJECT', 'b']] }] })).to.throw(/^Filter "bad": /);
    });
});

describe('validateFilters', () => {
    it('points to the converter for old configs', () => {
        const old = [{ name: 'a', rules: [['UNSEEN']] }] as unknown as Filter[];
        expect(() => validateFilters(old, '/opt/x/config.json')).to.throw('node dist/convertConfig.js /opt/x/config.json');
        expect(() => validateFilters([{ name: 'b' } as Filter], 'c.json')).to.throw(/needs a "search" object/);
        expect(() => validateFilters([{ name: 'c', search: { seen: false } } as Filter], 'c.json')).not.to.throw();
    });
});
