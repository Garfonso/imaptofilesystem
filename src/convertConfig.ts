/**
 * One time migration: replaces the old filter "rules" by "search" (imapflow search object).
 * Writes a backup next to the config. Usage: node dist/convertConfig.js [config.json]
 * Can be removed when no old config is left.
 */
import path from 'path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { convertRules, type NodeImapCriterion } from './convertRules';

/**
 * Convert all filters of a parsed config. Returns the number of converted filters.
 *
 * @param config - parsed config.json
 * @param config.filters - filters, converted in place
 */
export function convertConfig(config: { filters?: Array<Record<string, unknown>> }): number {
    let converted = 0;
    for (const filter of config.filters ?? []) {
        if (filter.rules === undefined) {
            continue;
        }
        if (filter.search !== undefined) {
            throw new Error(`Filter "${String(filter.name)}" has "rules" and "search", remove one.`);
        }
        try {
            filter.search = convertRules(filter.rules as NodeImapCriterion[]);
        } catch (e) {
            throw new Error(`Filter "${String(filter.name)}": ${(e as Error).message}`);
        }
        delete filter.rules;
        converted += 1;
    }
    return converted;
}

async function main(): Promise<void> {
    const file = process.argv[2] ?? path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(await readFile(file, 'utf-8'));
    const converted = convertConfig(config);
    if (converted === 0) {
        console.log(`${file}: nothing to convert.`);
        return;
    }
    await copyFile(file, `${file}.bak`);
    await writeFile(file, `${JSON.stringify(config, null, 4)}\n`);
    console.log(`${file}: converted ${converted} filters, backup in ${file}.bak`);
}

if (require.main === module) {
    main().catch(e => {
        console.error((e as Error).message);
        process.exit(1);
    });
}
