/**
 * WeixinEventTransport - Manages Weixin bot lifecycle and long-polling.
 *
 * Unlike SlackEventTransport which receives webhooks via HTTP, this transport:
 * 1. Connects to Weixin via QR code login (bot.login())
 * 2. Starts the internal poll loop (bot.start())
 * 3. Receives messages via the 'message' event
 * 4. Translates messages to InternalMessage and emits them
 *
 * Lifecycle:
 * - Construct → login() → start() → (messages emitted) → stop()
 */

import { EventEmitter } from "node:events";
import type { ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import type { WeixinBot } from "weixin-bot-sdk";
import { WeixinBot as WeixinBotClass } from "weixin-bot-sdk";
import type {
	WeixinCredentials,
	WeixinEventTransportConfig,
	WeixinEventTransportEvents,
	WeixinParsedMessage,
} from "./types.js";
import { WeixinMessageTranslator } from "./WeixinMessageTranslator.js";

export declare interface WeixinEventTransport {
	on<K extends keyof WeixinEventTransportEvents>(
		event: K,
		listener: WeixinEventTransportEvents[K],
	): this;
	emit<K extends keyof WeixinEventTransportEvents>(
		event: K,
		...args: Parameters<WeixinEventTransportEvents[K]>
	): boolean;
}

/**
 * WeixinEventTransport - Manages Weixin bot lifecycle and long-polling.
 *
 * This class wraps the weixin-bot-sdk's WeixinBot and provides:
 * - EventEmitter interface for message/ lifecycle events
 * - Automatic login with QR code callback
 * - Message translation to InternalMessage format
 * - Credential persistence
 */
export class WeixinEventTransport extends EventEmitter {
	private config: WeixinEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: WeixinMessageTranslator;
	private bot: WeixinBot | null = null;
	private _running = false;

	constructor(config: WeixinEventTransportConfig, logger?: ILogger) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "WeixinEventTransport" });
		this.messageTranslator = new WeixinMessageTranslator();
	}

	/**
	 * Login to Weixin via QR code.
	 *
	 * If credentials already exist at credentialsPath and are valid,
	 * this loads them directly without showing a QR code.
	 *
	 * @returns Promise that resolves when login is complete
	 */
	async login(): Promise<void> {
		this.bot = new WeixinBotClass({
			credentialsPath: this.config.credentialsPath,
		}) as WeixinBot;

		// If credentials already exist and bot is logged in, skip login
		if (this.bot.isLoggedIn) {
			this.logger.info("Using existing Weixin credentials");
			this.emit("credentialsLoaded", {
				botToken:
					(this.bot as unknown as { api: { token: string } }).api.token ?? "",
			});
			return;
		}

		// Perform QR code login
		this.logger.info("Starting Weixin QR code login...");

		const result = await (
			this.bot as unknown as {
				login(options?: Record<string, unknown>): Promise<WeixinCredentials>;
			}
		).login({
			onQrCode: (qrCodeDataUrl: string) => {
				this.logger.info("QR code received for Weixin login");
				this.config.onQrCode?.(qrCodeDataUrl);
			},
			onStatus: (status: string) => {
				this.logger.debug(`Weixin login status: ${status}`);
				this.config.onStatus?.(status);
			},
			timeoutMs: this.config.timeoutMs ?? 120_000,
		});

		this.logger.info(`Weixin login successful: botId=${result.botId}`);

		// Forward credentials:loaded event from bot
		(
			this.bot as unknown as {
				on(event: string, listener: (creds: WeixinCredentials) => void): void;
			}
		).on("credentials:loaded", (creds: WeixinCredentials) => {
			this.emit("credentialsLoaded", creds);
		});
	}

	/**
	 * Start the long-polling message loop.
	 *
	 * Messages will be received via the 'message' event and translated
	 * to InternalMessage format before being emitted.
	 *
	 * @throws Error if login() hasn't been called first
	 */
	start(): void {
		if (!this.bot) {
			throw new Error("Bot not initialized. Call login() first.");
		}
		if (this._running) {
			this.logger.warn("WeixinEventTransport already running");
			return;
		}

		this.bot.start();
		this._running = true;
		this.logger.info("WeixinEventTransport started");

		// Forward bot events
		this.bot.on("message", (parsed: WeixinParsedMessage, raw: unknown) => {
			this.handleMessage(parsed, raw as Record<string, unknown>);
		});

		this.bot.on("session:expired", () => {
			this.logger.warn("Weixin session expired");
			this.emit("sessionExpired");
			this.stop();
		});

		this.bot.on("error", (error: Error) => {
			this.logger.error("Weixin bot error", error);
			this.emit("error", error);
		});

		this.bot.on("stop", () => {
			this.logger.info("Weixin bot stopped");
			this._running = false;
			this.emit("stop");
		});

		this.emit("ready");
	}

	/**
	 * Stop the transport and polling loop.
	 */
	stop(): void {
		if (this.bot && this._running) {
			this.bot.stop();
		}
		this._running = false;
	}

	/**
	 * Get the underlying bot instance for sending messages.
	 *
	 * @throws Error if login() hasn't been called
	 */
	getBot(): WeixinBot {
		if (!this.bot) {
			throw new Error("Bot not initialized. Call login() first.");
		}
		return this.bot;
	}

	/**
	 * Check if transport is running.
	 */
	get isRunning(): boolean {
		return this._running;
	}

	/**
	 * Get the message translator for session management.
	 */
	getTranslator(): WeixinMessageTranslator {
		return this.messageTranslator;
	}

	/**
	 * Handle incoming message from Weixin bot.
	 */
	private handleMessage(
		parsed: WeixinParsedMessage,
		raw: Record<string, unknown>,
	): void {
		// Always emit raw event first (before translation)
		this.emit("rawEvent", parsed);

		try {
			// Translate to InternalMessage
			const result = this.messageTranslator.translate(parsed, {
				metadata: { raw },
			});

			if (result.success) {
				this.logger.info(
					`Received Weixin message from user ${parsed.from}: "${parsed.text?.slice(0, 50)}..."`,
				);
				this.emit("message", result.message);
			} else {
				this.logger.debug(`Message translation skipped: ${result.reason}`);
			}
		} catch (error) {
			this.logger.error(
				"Failed to process Weixin message",
				error instanceof Error ? error : new Error(String(error)),
			);
			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
