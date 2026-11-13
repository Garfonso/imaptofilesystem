/**
 * Converts the old filter "rules" (node-imap search criteria, nested arrays) to imapflow
 * search objects. Only needed once to migrate a config, see convertConfig.ts.
 * Can be removed when no old config is left.
 */
import type { SearchObject } from 'imap-idle-keep-connection';

/** node-imap search criterion: 'UNSEEN', ['SUBJECT', 'x'], ['OR', a, b], ['!FROM', 'x'], ... */
export type NodeImapCriterion = string | NodeImapCriterionArray;
type NodeImapCriterionArray = Array<string | number | NodeImapCriterion>;

const FLAGS: Record<string, SearchObject> = {
    ALL: { all: true },
    ANSWERED: { answered: true },
    UNANSWERED: { answered: false },
    DELETED: { deleted: true },
    UNDELETED: { deleted: false },
    DRAFT: { draft: true },
    UNDRAFT: { draft: false },
    FLAGGED: { flagged: true },
    UNFLAGGED: { flagged: false },
    SEEN: { seen: true },
    UNSEEN: { seen: false },
    NEW: { new: true },
    OLD: { old: true },
    RECENT: { recent: true },
};

const STRING_KEYS: Record<string, keyof SearchObject> = {
    FROM: 'from',
    TO: 'to',
    CC: 'cc',
    BCC: 'bcc',
    SUBJECT: 'subject',
    BODY: 'body',
    TEXT: 'text',
    KEYWORD: 'keyword',
    UNKEYWORD: 'unKeyword',
    UID: 'uid',
    SINCE: 'since',
    BEFORE: 'before',
    ON: 'on',
    SENTSINCE: 'sentSince',
    SENTBEFORE: 'sentBefore',
    SENTON: 'sentOn',
};

const NUMBER_KEYS: Record<string, keyof SearchObject> = {
    LARGER: 'larger',
    SMALLER: 'smaller',
};

/**
 * Convert a list of criteria (all have to match) to one search object.
 *
 * @param rules - node-imap criteria
 */
export function convertRules(rules: NodeImapCriterion[]): SearchObject {
    const result: SearchObject = {};
    for (const rule of rules) {
        merge(result, convertCriterion(rule), rule);
    }
    return result;
}

function convertCriterion(criterion: NodeImapCriterion): SearchObject {
    const [rawName, ...args] = typeof criterion === 'string' ? [criterion] : criterion;
    if (typeof rawName !== 'string') {
        throw new Error(`Unsupported rule ${JSON.stringify(criterion)}: must start with a name.`);
    }
    const name = rawName.toUpperCase();
    if (name.startsWith('!')) {
        return { not: convertCriterion([name.slice(1), ...args]) };
    }
    if (name === 'NOT') {
        return { not: convertCriterion(args[0] as NodeImapCriterion) };
    }
    if (name === 'OR') {
        if (args.length !== 2) {
            throw new Error(`Unsupported rule ${JSON.stringify(criterion)}: OR needs two criteria.`);
        }
        const or: SearchObject[] = [];
        for (const arg of args) {
            const converted = convertCriterion(arg as NodeImapCriterion);
            // OR(OR(a, b), c) -> or: [a, b, c]
            if (Object.keys(converted).length === 1 && converted.or) {
                or.push(...converted.or);
            } else {
                or.push(converted);
            }
        }
        return { or };
    }
    if (FLAGS[name] && args.length === 0) {
        return { ...FLAGS[name] };
    }
    if (name === 'HEADER' && args.length === 2) {
        return { header: { [String(args[0])]: String(args[1]) } };
    }
    if (STRING_KEYS[name] && args.length === 1) {
        return { [STRING_KEYS[name]]: String(args[0]) };
    }
    if (NUMBER_KEYS[name] && args.length === 1) {
        return { [NUMBER_KEYS[name]]: Number(args[0]) };
    }
    throw new Error(`Unsupported rule ${JSON.stringify(criterion)}, please convert "${rawName}" by hand.`);
}

function merge(target: SearchObject, source: SearchObject, rule: NodeImapCriterion): void {
    for (const [key, value] of Object.entries(source) as Array<[keyof SearchObject, unknown]>) {
        if (key === 'header' && target.header) {
            for (const [header, headerValue] of Object.entries(value as Record<string, string>)) {
                if (header in target.header) {
                    throw conflict(rule);
                }
                target.header[header] = headerValue;
            }
        } else if (key in target) {
            throw conflict(rule);
        } else {
            (target as Record<string, unknown>)[key] = value;
        }
    }
}

function conflict(rule: NodeImapCriterion): Error {
    return new Error(
        `Rule ${JSON.stringify(rule)} conflicts with an earlier rule of the same kind, please convert by hand.`,
    );
}
