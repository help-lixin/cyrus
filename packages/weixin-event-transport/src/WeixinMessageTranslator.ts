/**
 * WeixinMessageTranslator - Translates Weixin parsed messages into InternalMessage format.
 *
 * Session model: Each user (fromUserId) gets an independent session.
 * - First message from a user → session_start
 * - Subsequent messages from same user → user_prompt
 *
 * Session key format: weixin:${fromUserId}
 */

import { randomUUID } from "node:crypto";
import type {
	IMessageTranslator,
	MessageSource,
	SessionStartMessage,
	TranslationResult,
	UserPromptMessage,
	WeixinSessionStartPlatformData,
	WeixinUserPromptPlatformData,
} from "cyrus-core";
import type { WeixinParsedMessage } from "./types.js";

/**
 * Translates Weixin parsed messages into InternalMessage format.
 *
 * Implements IMessageTranslator<WeixinParsedMessage> from cyrus-core.
 */
export class WeixinMessageTranslator
	implements IMessageTranslator<WeixinParsedMessage>
{
	/**
	 * Map of known sessions (userId → true).
	 * Tracks which users have an existing session.
	 *
	 * In EdgeWorker context, this state is typically persisted/shared,
	 * but for the translator we maintain it here for simplicity.
	 */
	private knownSessions = new Map<string, boolean>();

	/**
	 * Mark a user's session as known (called after session starts successfully).
	 */
	markSessionKnown(userId: string): void {
		this.knownSessions.set(`weixin:${userId}`, true);
	}

	/**
	 * Check if a message is from a known session.
	 */
	isSessionKnown(userId: string): boolean {
		return this.knownSessions.get(`weixin:${userId}`) === true;
	}

	/**
	 * Check if this translator can handle the given webhook.
	 */
	canTranslate(event: unknown): event is WeixinParsedMessage {
		if (!event || typeof event !== "object") {
			return false;
		}
		const e = event as Record<string, unknown>;
		return (
			typeof e.from === "string" &&
			typeof e.to === "string" &&
			typeof e.text === "string"
		);
	}

	/**
	 * Translate a Weixin message into an InternalMessage.
	 *
	 * Determines whether this is a session start or user prompt based on
	 * whether we already have a session for this user.
	 */
	translate(
		parsed: WeixinParsedMessage,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_context?: Parameters<
			IMessageTranslator<WeixinParsedMessage>["translate"]
		>[1],
	): TranslationResult {
		const sessionKey = `weixin:${parsed.from}`;

		// Check if this is a group message (group_id is set)
		// Weixin bot SDK doesn't support group chats
		if (this.isGroupMessage(parsed)) {
			return {
				success: false,
				reason: "Group messages not supported",
			};
		}

		// Check if this is a bot message (from === to, i.e., bot echoing)
		if (parsed.from === parsed.to) {
			return {
				success: false,
				reason: "Ignoring bot's own message",
			};
		}

		const isKnown = this.isSessionKnown(parsed.from);

		if (isKnown) {
			return this.translateAsUserPrompt(parsed, sessionKey);
		}

		// First message from this user - start a new session
		this.markSessionKnown(parsed.from);
		return this.translateAsSessionStart(parsed, sessionKey);
	}

	/**
	 * Detect if a message is from a group chat.
	 * The SDK doesn't explicitly mark group messages, but if the message
	 * has a group_id or if the 'to' field is different from the bot's ID
	 * (and it's not a direct reply), it might be group-related.
	 *
	 * Since we don't have the bot's ID here, we rely on the group_id field
	 * in the raw message if available.
	 */
	private isGroupMessage(parsed: WeixinParsedMessage): boolean {
		// Check raw message for group_id
		const raw = parsed.raw as { group_id?: string };
		if (raw.group_id && raw.group_id.length > 0) {
			return true;
		}
		return false;
	}

	/**
	 * Translate as a session start message.
	 */
	private translateAsSessionStart(
		parsed: WeixinParsedMessage,
		sessionKey: string,
	): TranslationResult {
		const platformData: WeixinSessionStartPlatformData = {
			channel: { id: parsed.from },
			thread: { ts: String(parsed.timestamp ?? Date.now()) },
			message: {
				messageId: String(parsed.messageId ?? ""),
				text: parsed.text ?? "",
				user: { id: parsed.from },
			},
		};

		// Build initial prompt from text and quoted context
		const initialPrompt = parsed.textWithQuote ?? parsed.text ?? "Hello";

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "weixin" as MessageSource,
			action: "session_start",
			receivedAt: new Date(parsed.timestamp ?? Date.now()).toISOString(),
			organizationId: "weixin",
			sessionKey,
			workItemId: `weixin:${parsed.from}`,
			workItemIdentifier: `weixin:${parsed.from}`,
			author: {
				id: parsed.from,
				name: parsed.from, // Weixin has no display name API; use userId
			},
			initialPrompt,
			title: (parsed.text ?? "Weixin message").slice(0, 100),
			platformData,
		};

		return { success: true, message };
	}

	/**
	 * Translate as a user prompt message.
	 */
	private translateAsUserPrompt(
		parsed: WeixinParsedMessage,
		sessionKey: string,
	): TranslationResult {
		const platformData: WeixinUserPromptPlatformData = {
			channel: { id: parsed.from },
			thread: { ts: String(parsed.timestamp ?? Date.now()) },
			message: {
				messageId: String(parsed.messageId ?? ""),
				text: parsed.text ?? "",
				user: { id: parsed.from },
			},
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "weixin" as MessageSource,
			action: "user_prompt",
			receivedAt: new Date(parsed.timestamp ?? Date.now()).toISOString(),
			organizationId: "weixin",
			sessionKey,
			workItemId: `weixin:${parsed.from}`,
			workItemIdentifier: `weixin:${parsed.from}`,
			author: {
				id: parsed.from,
				name: parsed.from,
			},
			content: parsed.textWithQuote ?? parsed.text ?? "",
			platformData,
		};

		return { success: true, message };
	}
}
