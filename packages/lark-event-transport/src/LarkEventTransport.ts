import { EventEmitter } from "node:events";
import {
	EventDispatcher,
	type NormalizedMessage,
	WSClient,
} from "@larksuiteoapi/node-sdk";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import { LarkMessageTranslator } from "./LarkMessageTranslator.js";
import type {
	LarkEventTransportConfig,
	LarkEventTransportEvents,
	LarkWebhookEvent,
} from "./types.js";

export declare interface LarkEventTransport {
	on<K extends keyof LarkEventTransportEvents>(
		event: K,
		listener: LarkEventTransportEvents[K],
	): this;
	emit<K extends keyof LarkEventTransportEvents>(
		event: K,
		...args: Parameters<LarkEventTransportEvents[K]>
	): boolean;
}

/**
 * LarkEventTransport - Handles Lark/Feishu WebSocket event delivery
 *
 * This class provides a typed EventEmitter-based transport
 * for handling Lark webhooks via WebSocket long connection.
 *
 * Supported Lark event types:
 * - im.message.receive_v1: When a message is received (including @mention)
 */
export class LarkEventTransport extends EventEmitter {
	private config: LarkEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: LarkMessageTranslator;
	private translationContext: TranslationContext;
	private wsClient?: WSClient;
	private eventDispatcher?: EventDispatcher;
	/**
	 * Recently emitted `chatId:messageId` keys, used to collapse
	 * potential duplicate deliveries.
	 * Maps key → epoch ms first seen; pruned by TTL.
	 */
	private recentMessageKeys: Map<string, number> = new Map();
	private static readonly DEDUP_TTL_MS = 10 * 60 * 1000;

	constructor(
		config: LarkEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "LarkEventTransport" });
		this.messageTranslator = new LarkMessageTranslator();
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
		this.eventDispatcher = new EventDispatcher({});

		// Register message event handler using any type to match SDK's expected signature
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.eventDispatcher.register({
			"im.message.receive_v1": this.handleMessageEvent.bind(this) as any,
			// P2P chat events - these fire when bot enters a P2P chat
			"im.chat.access_event.bot_p2p_chat_entered_v1":
				this.handleBotP2PChatEntered.bind(this) as any,
			// Legacy P2P chat creation event (some Feishu configurations use this)
			p2p_chat_create: this.handleP2PChatCreate.bind(this) as any,
			// Message read event - fired when messages are read
			"im.message.message_read_v1": this.handleMessageRead.bind(this) as any,
		});

		// Create WebSocket client
		this.wsClient = new WSClient({
			appId: this.config.appId,
			appSecret: this.config.appSecret,
			autoReconnect: this.config.autoReconnect ?? true,
			onReady: () => {
				this.logger.info("Lark WebSocket connected successfully");
				this.emit("connected");
			},
			onError: (err: Error) => {
				this.logger.error("Lark WebSocket error", err);
				this.emit("error", err);
			},
			onReconnecting: () => {
				this.logger.info("Lark WebSocket reconnecting");
				this.emit("reconnecting");
			},
			onReconnected: () => {
				this.logger.info("Lark WebSocket reconnected");
				this.emit("connected");
			},
		});

		// Start the WebSocket connection
		await this.wsClient.start({
			eventDispatcher: this.eventDispatcher,
		});

		this.logger.info(
			`Lark WebSocket event transport started (appId: ${this.config.appId})`,
		);
	}

	/**
	 * Handle incoming message events from Lark
	 *
	 * The Lark SDK passes raw event data with snake_case fields.
	 * We manually convert to camelCase format for compatibility with the rest of the codebase.
	 * For P2P chats, mentionedBot is false since @mention is not required.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleMessageEvent(data: any): void {
		// console.log("[LarkEventTransport] handleMessageEvent called, data keys=" + JSON.stringify(Object.keys(data || {})));

		// Lark SDK passes the event data with message property (raw snake_case format)
		const rawMessage = data.message;
		if (!rawMessage) {
			// console.log("[LarkEventTransport] Received message event without message content, data=" + JSON.stringify(data));
			this.logger.debug(
				`Received message event without message content, data=${JSON.stringify(data)}`,
			);
			return;
		}

		// Build a NormalizedMessage from raw snake_case data
		// Field mapping: chat_id -> chatId, message_id -> messageId, etc.
		const message: NormalizedMessage = {
			messageId: rawMessage.message_id,
			chatId: rawMessage.chat_id,
			chatType: rawMessage.chat_type,
			senderId:
				data.sender?.sender_id?.open_id ||
				data.sender?.sender_id?.user_id ||
				"",
			senderName: undefined,
			content: this.extractTextContent(rawMessage.content),
			rawContentType: rawMessage.message_type,
			resources: [],
			mentions: [],
			mentionAll: false,
			mentionedBot:
				rawMessage.chat_type === "p2p"
					? false
					: rawMessage.mentioned_bot || false,
			rootId: rawMessage.root_id,
			threadId: rawMessage.thread_id,
			replyToMessageId: rawMessage.parent_id,
			createTime: parseInt(rawMessage.create_time, 10) || Date.now(),
			raw: rawMessage,
		};

		// console.log(`[LarkEventTransport] Built message: chatId=${message.chatId}, chatType=${message.chatType}, mentionedBot=${message.mentionedBot}, messageId=${message.messageId}`);

		// Filter: ignore messages not mentioning the bot (for session start)
		// User prompt messages can still be processed for existing threads
		// Allow all messages in p2p (1:1 direct) chats since every message is relevant there
		//
		// IMPORTANT for P2P chats:
		// - In P2P, mentionedBot is typically false (no @mention needed)
		// - First message in P2P has no rootId/replyToMessageId
		// - The condition below allows all P2P messages through (chatType !== "p2p" is false)
		const isP2P = message.chatType === "p2p";
		// console.log(`[LarkEventTransport] Message filter check: chatId=${message.chatId}, chatType=${message.chatType}, mentionedBot=${message.mentionedBot}, rootId=${message.rootId}, replyToMessageId=${message.replyToMessageId}, isP2P=${isP2P}`);

		if (
			!message.mentionedBot &&
			!message.rootId &&
			!message.replyToMessageId &&
			message.chatType !== "p2p"
		) {
			this.logger.debug(
				`Ignoring message not mentioning bot (chatId: ${message.chatId}, messageId: ${message.messageId})`,
			);
			return;
		}

		// De-duplicate on (chatId, messageId)
		const dedupKey = `${message.chatId}:${message.messageId}`;
		if (this.isDuplicateMessage(dedupKey)) {
			this.logger.debug(
				`Ignoring duplicate Lark message for ${dedupKey} (already processed)`,
			);
			return;
		}
		this.rememberMessage(dedupKey);

		// Thread-following can be disabled
		if (
			this.config.isThreadFollowingEnabled &&
			!this.config.isThreadFollowingEnabled()
		) {
			// If thread following is disabled, only process @mention messages
			// BUT always allow P2P messages since they don't need @mention
			if (!message.mentionedBot && !isP2P) {
				this.logger.debug(
					`Lark thread-following disabled; ignoring message event (chatId: ${message.chatId})`,
				);
				return;
			}
		}

		const webhookEvent: LarkWebhookEvent = {
			eventType: "im.message.receive_v1",
			eventId: message.messageId,
			payload: message,
			tenantKey: message.senderId,
			rawEvent: data,
		};

		this.logger.info(
			`Received im.message.receive_v1 (chatId: ${message.chatId}, messageId: ${message.messageId}, mentionedBot: ${message.mentionedBot})`,
		);

		// Emit "event" for transport-level listeners
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);
	}

	/**
	 * Extract plain text content from Lark message content JSON
	 */
	private extractTextContent(content: string): string {
		if (!content) return "";
		try {
			const parsed = JSON.parse(content);
			if (parsed.text) {
				return parsed.text;
			}
			return content;
		} catch {
			return content;
		}
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
			if (now - seenAt > LarkEventTransport.DEDUP_TTL_MS) {
				this.recentMessageKeys.delete(key);
			}
		}
	}

	/**
	 * Translate and emit an internal message from a webhook event.
	 */
	private emitMessage(event: LarkWebhookEvent): void {
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
	 * Handle bot_p2p_chat_entered_v1 event.
	 * This fires when the bot enters a P2P chat, which happens when a user
	 * starts a conversation with the bot for the first time.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleBotP2PChatEntered(data: any): void {
		// console.log(`[LarkEventTransport] Bot entered P2P chat, data keys=${JSON.stringify(Object.keys(data || {}))}, full data=${JSON.stringify(data)}`);
		this.logger.info(`Bot entered P2P chat: ${JSON.stringify(data)}`);

		// For P2P chat access events, extract chat info if available
		// The event structure may contain chat_id directly or inside event property
		const chatId = data.chat_id || data.event?.chat_id || data.chatId;
		if (chatId) {
			// console.log(`[LarkEventTransport] P2P chat access for chatId=${chatId}`);
		}

		// Emit a generic event so listeners know the bot is ready in this chat
		this.emit("botP2PChatEntered", data);
	}

	/**
	 * Handle p2p_chat_create event (legacy handler).
	 * This is a fallback handler in case the legacy event name is used.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleP2PChatCreate(data: any): void {
		// console.log(`[LarkEventTransport] P2P chat created: ${JSON.stringify(data)}`);
		// this.logger.info(`P2P chat created: ${JSON.stringify(data)}`);
		this.emit("p2pChatCreated", data);
	}

	/**
	 * Handle im.message.message_read_v1 event.
	 * This fires when messages have been read by users.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleMessageRead(data: any): void {
		// console.log(`[LarkEventTransport] Message read event: ${JSON.stringify(data)}`);
		this.logger.debug(`Lark message read event: ${JSON.stringify(data)}`);
		// We don't need to do anything special for message read events currently
		// Just acknowledge it exists to avoid the "no handle" warning
	}

	/**
	 * Close the WebSocket connection
	 */
	async close(): Promise<void> {
		if (this.wsClient) {
			this.wsClient.close({ force: true });
			this.wsClient = undefined;
			this.eventDispatcher = undefined;
			this.logger.info("Lark WebSocket connection closed");
			this.emit("disconnected");
		}
	}

	/**
	 * Get current connection status
	 */
	getConnectionStatus(): string {
		if (!this.wsClient) {
			return "idle";
		}
		const status = this.wsClient.getConnectionStatus();
		return status.state;
	}
}
