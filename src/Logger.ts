import { Logger as Seq, type SeqLogLevel } from 'seq-logging';
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

/**
 * Logger class with seq support.
 */
export class Logger {
    private readonly name: string;
    private readonly debugLogging: boolean;
    private readonly useConsole: boolean;
    private seqLogger: Seq | undefined;
    private static useSeq = false;
    private static serverUrl = 'http://localhost:5341';
    private static apiKey = '';
    private static defaultDebug = false;
    private static defaultUseConsole = true;

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
     * Set the configuration for the logger.
     *
     * @param config - configuration
     */
    static setConfig(config: LoggerConfig): void {
        Logger.serverUrl = config.serverUrl || Logger.serverUrl;
        Logger.apiKey = config.apiKey || Logger.apiKey;
        Logger.useSeq = config.useSeq || false;
        Logger.defaultDebug = config.debug || false;
        Logger.defaultUseConsole = config.useConsole || true;
    }

    /**
     * Create a logger with a name. Name is added in front of all output.
     *
     * @param name - name of the logger
     * @param debug - enable debug logging
     * @param useConsole - enable console logging
     */
    constructor(name: string, debug = Logger.defaultDebug, useConsole = Logger.defaultUseConsole) {
        this.name = name;
        this.debugLogging = debug;
        this.useConsole = useConsole;
    }

    private log(level: SeqLogLevel, ...msgs: any[]): void {
        msgs.unshift(new Date().toISOString());
        msgs.unshift(this.name);
        if (this.useConsole) {
            console.log(...msgs);
        }
        if (Logger.useSeq) {
            if (!this.seqLogger) {
                this.seqLogger = new Seq({
                    onError(e: Error): void {
                        console.error('Error in Seq logger:', e);
                    },
                    serverUrl: Logger.serverUrl,
                    apiKey: Logger.apiKey,
                });
            }
            this.seqLogger.emit({
                timestamp: new Date(),
                level: level,
                messageTemplate: msgs.map(e => (typeof e === 'string' ? e : util.inspect(e))).join(' '),
                //properties: msgs.filter(e => typeof e !== 'string') -> I'm doing something wrong here, it seems.
            });
        }
    }

    /**
     * Log debug
     *
     * @param msgs - messages to log
     */
    debug(...msgs: any[]): void {
        if (this.debugLogging) {
            this.log('Debug', ...msgs);
        }
    }

    /**
     * Log information
     *
     * @param msgs - messages to log
     */
    info(...msgs: any[]): void {
        this.log('Information', ...msgs);
    }

    /**
     * Log warning
     *
     * @param msgs - messages to log
     */
    warn(...msgs: any[]): void {
        this.log('Warning', ...msgs);
    }

    /**
     * Log error
     *
     * @param msgs - messages to log
     */
    error(...msgs: any[]): void {
        this.log('Error', ...msgs);
    }
}
