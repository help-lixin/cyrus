/**
 * QQEventTransport - Handles QQ Open Platform WebSocket event delivery
 *
 * This class provides a typed EventEmitter-based transport
 * for handling QQ messages via WebSocket connection.
 *
 * It connects to the QQ Open Platform using the QQBot SDK
 * and emits message events for processing by the EdgeWorker.
 *
 * Supported QQ message types:
 * - C2C (private chat): Direct messages from users
 * - Group: Messages in group chats where the bot is mentioned
 */

import { EventEmitter } from "node:events";
import type { ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import {
	errorHandler,
	mentionGate,
	messageFilter,
	QQBot,
} from "@tencent-connect/qqbot-nodejs";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import { QQMessageTranslator } from "./QQMessageTranslator.js";
import type {
	QQEventTransportConfig,
	QQEventTransportEvents,
	QQWebhookEvent,
} from "./types.js";

export declare interface QQEventTransport {
	on<K extends keyof QQEventTransportEvents>(
		event: K,
		listener: QQEventTransportEvents[K],
	): this;
	emit<K extends keyof QQEventTransportEvents>(
		event: K,
		...args: Parameters<QQEventTransportEvents[K]>
	): boolean;
}

/**
 * QQEventTransport - WebSocket-based transport for QQ Open Platform
 */
export class QQEventTransport extends EventEmitter {
	private config: QQEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: QQMessageTranslator;
	private translationContext: TranslationContext;
	private bot: QQBot | null = null;
	private isRunning = false;

	constructor(
		config: QQEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "QQEventTransport" });
		this.messageTranslator = new QQMessageTranslator();
		this.translationContext = translationContext ?? {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Start the QQ bot and begin receiving events via WebSocket.
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			this.logger.info("QQ bot is already running");
			return;
		}

		try {
			this.logger.info("🔍 QQEventTransport check: Initializing QQ bot...");
			// Create QQBot instance with WebSocket transport (default)
			this.bot = new QQBot({
				appId: this.config.appId,
				appSecret: this.config.appSecret,
				logger: this.logger,
				markdownSupport: this.config.markdownSupport ?? false,
			});

			// Apply middleware
			this.bot.use(errorHandler());
			this.bot.use(
				messageFilter({
					skipSelfEcho: true,
					dedup: { windowMs: 5000 },
				}),
			);
			this.bot.use(mentionGate());

			// Register event handlers
			this.bot.on("ready", () => {
				this.logger.info("QQ bot is ready and connected");
			});

			this.bot.on("resumed", () => {
				this.logger.info("QQ bot connection resumed");
			});

			this.bot.on("error", (err: Error) => {
				this.logger.error("QQ bot error", err);
				this.emit("error", err);
			});

			// Handle message events
			this.bot.on("message", (_ctx, msg) => {
				this.handleMessage(msg);
			});

			// Start the bot in the background.
			// NOTE: bot.start() never resolves (it waits for abortSignal to stop).
			// We fire it with void and wait for the "ready" event instead.
			void this.bot.start();

			// Wait for the bot to emit "ready" before considering start() complete.
			// This is the signal that the WebSocket gateway is connected and operational.
			await new Promise<void>((resolve) => {
				this.bot!.on("ready", () => {
					this.logger.info("[QQEventTransport] start(): bot ready event fired");
					resolve();
				});
			});

			this.isRunning = true;
			this.logger.info(
				"🔍 QQEventTransport check: WebSocket connected to QQ Open Platform",
			);
			this.logger.info("QQ event transport started");
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.logger.error("Failed to start QQ bot", err);
			this.emit("error", err);
			throw err;
		}
	}

	/**
	 * Stop the QQ bot and disconnect.
	 */
	stop(): void {
		if (this.bot && this.isRunning) {
			this.bot.stop();
			this.isRunning = false;
			this.logger.info("QQ event transport stopped");
		}
	}

	/**
	 * Handle incoming QQ message.
	 */
	private handleMessage(msg: {
		messageId: string;
		content: string;
		senderId: string;
		senderName?: string;
		kind: string;
		replyTarget: ReplyTarget;
	}): void {
		try {
			// Create webhook event
			const webhookEvent: QQWebhookEvent = {
				eventId: msg.messageId,
				payload: msg as QQWebhookEvent["payload"],
			};

			// Emit raw event for transport-level listeners
			this.emit("event", webhookEvent);

			// Emit translated internal message
			this.emitMessage(webhookEvent);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.logger.error("Error handling QQ message", err);
			this.emit("error", err);
		}
	}

	/**
	 * Translate and emit an internal message from a QQ event.
	 * Only emits if translation succeeds; logs debug message on failure.
	 */
	private emitMessage(event: QQWebhookEvent): void {
		const result = this.messageTranslator.translate(
			event,
			this.translationContext,
		);

		if (result.success) {
			this.emit("message", result.message);
		} else {
			this.logger.debug(`Message translation skipped: ${result.reason}`);
		}
	}

	/**
	 * Get the QQ bot instance for direct API access.
	 */
	getBot(): QQBot | null {
		return this.bot;
	}
}
