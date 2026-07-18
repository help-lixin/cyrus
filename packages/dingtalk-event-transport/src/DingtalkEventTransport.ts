import { EventEmitter } from "node:events";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import {
	DWClient,
	type DWClientDownStream,
	TOPIC_ROBOT,
} from "dingtalk-stream-sdk-nodejs";
import { DingtalkMessageTranslator } from "./DingtalkMessageTranslator.js";
import type {
	DingtalkEventTransportConfig,
	DingtalkEventTransportEvents,
	DingtalkRobotMessage,
	DingtalkWebhookEvent,
} from "./types.js";

export declare interface DingtalkEventTransport {
	on<K extends keyof DingtalkEventTransportEvents>(
		event: K,
		listener: DingtalkEventTransportEvents[K],
	): this;
	emit<K extends keyof DingtalkEventTransportEvents>(
		event: K,
		...args: Parameters<DingtalkEventTransportEvents[K]>
	): boolean;
}

/**
 * DingtalkEventTransport - Handles DingTalk Stream mode event delivery
 *
 * This class provides a typed EventEmitter-based transport
 * for handling DingTalk robot messages via WebSocket long connection
 * (dingtalk-stream-sdk-nodejs DWClient).
 *
 * Supported DingTalk event types:
 * - robot.message.receive: A message delivered to the robot on the Stream
 *   topic `/v1.0/im/bot/messages/get`. In group chats DingTalk only delivers
 *   messages that @mention the bot; in 1:1 (single) chats every message is
 *   delivered. Messages are de-duplicated on (conversationId, msgId) to
 *   collapse potential duplicate deliveries.
 */
export class DingtalkEventTransport extends EventEmitter {
	private config: DingtalkEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: DingtalkMessageTranslator;
	private translationContext: TranslationContext;
	private client?: DWClient;
	/**
	 * Recently emitted `conversationId:msgId` keys, used to collapse
	 * potential duplicate deliveries.
	 * Maps key → epoch ms first seen; pruned by TTL.
	 */
	private recentMessageKeys: Map<string, number> = new Map();
	private static readonly DEDUP_TTL_MS = 10 * 60 * 1000;

	constructor(
		config: DingtalkEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger =
			logger ?? createLogger({ component: "DingtalkEventTransport" });
		this.messageTranslator = new DingtalkMessageTranslator();
		this.translationContext = translationContext ?? {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Register and start the WebSocket connection
	 */
	async register(): Promise<void> {
		// Create the Stream mode client. The SDK's DWClient constructor accepts
		// clientId/clientSecret — these are the app's appKey/appSecret.
		this.client = new DWClient({
			clientId: this.config.appKey,
			clientSecret: this.config.appSecret,
			keepAlive: true,
		});

		// Register the robot message callback
		this.client.registerCallbackListener(
			TOPIC_ROBOT,
			this.handleMessageEvent.bind(this),
		);

		// Start the WebSocket connection
		await this.client.connect();

		this.emit("connected");
		this.logger.info(
			`DingTalk WebSocket event transport started (appKey: ${this.config.appKey})`,
		);
	}

	/**
	 * Handle incoming robot messages from DingTalk.
	 *
	 * The SDK delivers a downstream frame whose `data` is a JSON string holding
	 * the robot message. For 1:1 (single) chats every message arrives; for
	 * group chats only @mentions arrive.
	 */
	private handleMessageEvent(downstream: DWClientDownStream): void {
		let message: DingtalkRobotMessage;
		try {
			message = JSON.parse(downstream.data) as DingtalkRobotMessage;
		} catch {
			this.logger.debug(
				`Received robot message with unparseable data: ${downstream.data}`,
			);
			return;
		}

		if (!message?.msgId) {
			this.logger.debug(
				`Received robot message without msgId, data=${downstream.data}`,
			);
			return;
		}

		// Only text messages are supported
		if (message.msgtype !== "text") {
			this.logger.debug(
				`Ignoring DingTalk message with msgtype "${message.msgtype}" (conversationId: ${message.conversationId})`,
			);
			return;
		}

		const isSingleChat = message.conversationType === "1";

		// De-duplicate on (conversationId, msgId)
		const dedupKey = `${message.conversationId}:${message.msgId}`;
		if (this.isDuplicateMessage(dedupKey)) {
			this.logger.debug(
				`Ignoring duplicate DingTalk message for ${dedupKey} (already processed)`,
			);
			return;
		}
		this.rememberMessage(dedupKey);

		// Thread-following can be disabled. When off, only process group messages
		// that @mention the bot; 1:1 messages are always allowed since every
		// message in a single chat is directed at the bot.
		if (
			this.config.isThreadFollowingEnabled &&
			!this.config.isThreadFollowingEnabled() &&
			!isSingleChat &&
			!message.isInAtList
		) {
			this.logger.debug(
				`DingTalk thread-following disabled; ignoring message event (conversationId: ${message.conversationId})`,
			);
			return;
		}

		const webhookEvent: DingtalkWebhookEvent = {
			eventType: "robot.message.receive",
			eventId: message.msgId,
			payload: message,
			tenantKey: message.chatbotCorpId,
			rawEvent: downstream,
		};

		this.logger.info(
			`Received robot.message.receive (conversationId: ${message.conversationId}, msgId: ${message.msgId}, conversationType: ${message.conversationType}, isInAtList: ${message.isInAtList ?? false})`,
		);

		// Emit "event" for transport-level listeners
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);
	}

	private isDuplicateMessage(key: string): boolean {
		this.pruneRecentMessageKeys();
		return this.recentMessageKeys.has(key);
	}

	private rememberMessage(key: string): void {
		this.recentMessageKeys.set(key, Date.now());
	}

	private pruneRecentMessageKeys(): void {
		const now = Date.now();
		for (const [key, seenAt] of this.recentMessageKeys) {
			if (now - seenAt > DingtalkEventTransport.DEDUP_TTL_MS) {
				this.recentMessageKeys.delete(key);
			}
		}
	}

	/**
	 * Translate and emit an internal message from a webhook event.
	 */
	private emitMessage(event: DingtalkWebhookEvent): void {
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
	 * Close the WebSocket connection
	 */
	close(): void {
		if (this.client) {
			this.client.disconnect();
			this.client = undefined;
			this.logger.info("DingTalk WebSocket connection closed");
			this.emit("disconnected");
		}
	}

	/**
	 * Get current connection status
	 */
	getConnectionStatus(): string {
		if (!this.client) {
			return "idle";
		}
		return this.client.connected ? "connected" : "disconnected";
	}
}
