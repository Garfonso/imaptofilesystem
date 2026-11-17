import type { SeqEvent, SeqLogLevel } from 'seq-logging';
import util from 'node:util';

export type LoggerConfig = {
    /**
     * Server URL for Seq.
     */
    serverUrl?: string;
    /**
     * API key for Seq.
     */
    apiKey?: string;
    /**
     * Enable seq logging. URL, and api key need to be filled accordingly.
     */
    useSeq?: boolean;
    /**
     * Enable debug logging for all loggers with default config.
     */
    debug?: boolean;
    /**
     * Enable console logging for all loggers with default config.
     */
    useConsole?: boolean;
};

/** the part of seq-logging's Logger we use. */
export interface SeqLike {
    /** queue an event */
    emit(event: SeqEvent): void;
    /** send the queue and stop the timers */
    close(): Promise<unknown>;
}

/**
 * Escape text for a Seq message template, { and } would be parsed as properties.
 *
 * @param text - text to escape
 */
export function escapeTemplate(text: string): string {
    return text.replace(/[{}]/g, c => c + c);
}

/**
 * Logger class with seq support. All loggers share one Seq connection, call Logger.close() before exit
 * to send the buffered events.
 */
export class Logger {
    private readonly name: string;
    private readonly debugLogging: boolean | undefined;
    private readonly useConsole: boolean | undefined;
    private static config: LoggerConfig = {};
    private static seq: Promise<SeqLike> | undefined;
    /**
     * Creates the Seq connection, replaceable for tests. seq-logging 3 is ESM with top-level await,
     * it can only be loaded with import().
     *
     * @param config - logger config with serverUrl and apiKey
     */
    static createSeq = async (config: LoggerConfig): Promise<SeqLike> => {
        const { Logger: Seq } = await import('seq-logging');
        return new Seq({
            serverUrl: config.serverUrl || 'http://localhost:5341',
            apiKey: config.apiKey || undefined,
            onError(e: Error): void {
                console.error('Error in Seq logger:', e.message ?? e);
            },
        });
    };

    /**
     * Create a logger with a name. Name is added in front of all output.
     *
     * @param name - name of the logger
     * @param name.name - name of the logger
     */
    static getLogger({ name }: { name: string }): Logger {
        return new Logger(name);
    }

    /**
     * Set the configuration for all loggers, also the ones created before.
     *
     * @param config - configuration
     */
    static setConfig(config: LoggerConfig | undefined): void {
        Logger.config = { ...config };
    }

    /**
     * Send buffered events to Seq and close the connection. Logging later opens a new one.
     */
    static async close(): Promise<void> {
        const seq = Logger.seq;
        Logger.seq = undefined;
        await (await seq?.catch(() => undefined))?.close();
    }

    /**
     * Create a logger with a name. Name is added in front of all output.
     *
     * @param name - name of the logger
     * @param debug - enable debug logging, default from config
     * @param useConsole - enable console logging, default from config (on)
     */
    constructor(name: string, debug?: boolean, useConsole?: boolean) {
        this.name = name;
        this.debugLogging = debug;
        this.useConsole = useConsole;
    }

    private log(level: SeqLogLevel, ...msgs: unknown[]): void {
        const timestamp = new Date();
        const text = msgs.map(e => (typeof e === 'string' ? e : util.inspect(e))).join(' ');
        if (this.useConsole ?? Logger.config.useConsole ?? true) {
            console.log(this.name, timestamp.toISOString(), text);
        }
        if (Logger.config.useSeq) {
            const event: SeqEvent = {
                timestamp,
                level,
                messageTemplate: `{Logger} ${escapeTemplate(text)}`,
                properties: { Logger: this.name },
            };
            // events stay in order: then() callbacks of one promise run in order.
            Logger.seq ??= Logger.createSeq(Logger.config);
            Logger.seq.then(seq => seq.emit(event)).catch(e => console.error('Error in Seq logger:', e));
        }
    }

    /**
     * Log debug
     *
     * @param msgs - messages to log
     */
    debug(...msgs: unknown[]): void {
        if (this.debugLogging ?? Logger.config.debug) {
            this.log('Debug', ...msgs);
        }
    }

    /**
     * Log information
     *
     * @param msgs - messages to log
     */
    info(...msgs: unknown[]): void {
        this.log('Information', ...msgs);
    }

    /**
     * Log warning
     *
     * @param msgs - messages to log
     */
    warn(...msgs: unknown[]): void {
        this.log('Warning', ...msgs);
    }

    /**
     * Log error
     *
     * @param msgs - messages to log
     */
    error(...msgs: unknown[]): void {
        this.log('Error', ...msgs);
    }
}
