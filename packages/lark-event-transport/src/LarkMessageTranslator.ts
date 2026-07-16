/**
 * Lark Message Translator
 *
 * Translates Lark webhook events into unified internal messages for the
 * internal message bus.
 */

import { randomUUID } from "node:crypto";
import type {
	IMessageTranslator,
	LarkPlatformRef,
	LarkSessionStartPlatformData,
	LarkUserPromptPlatformData,
	SessionStartMessage,
	TranslationContext,
	TranslationResult,
	UserPromptMessage,
} from "cyrus-core";
import type { LarkWebhookEvent } from "./types.js";

/**
 * Build channel reference from chat data.
 */
function buildChannelRef(
	chatId: string,
	chatType: "p2p" | "group",
): LarkPlatformRef["channel"] {
	return {
		id: chatId,
		type: chatType,
	};
}

/**
 * Build thread reference from message data.
 */
function buildThreadRef(
	messageId: string,
	rootId?: string,
	replyToMessageId?: string,
): LarkPlatformRef["thread"] {
	return {
		messageId,
		parentId: replyToMessageId,
		rootId,
	};
}

/**
 * Build message reference from normalized message.
 */
function buildMessageRef(
	message: LarkWebhookEvent["payload"],
): LarkPlatformRef["message"] {
	return {
		messageId: message.messageId,
		text: message.content,
		mentionedBot: message.mentionedBot,
		user: {
			id: message.senderId,
			name: message.senderName,
		},
	};
}

/**
 * Strips the @mention prefix from Lark message text.
 * Lark mentions are in the format <at user_id="xxx"> at the start of the text.
 */
export function stripMention(text: string): string {
	// Lark markdown format: <at user_id="xxx">name</at>
	return text
		.replace(/^\s*<at\s+user_id\s*=\s*["'][^"']+["']\s*>.*?<\/at>\s*/i, "")
		.trim();
}

/**
 * Translates Lark webhook events into internal messages.
 *
 * Note: Lark webhooks can result in either:
 * - SessionStartMessage: First mention in a channel/thread that starts a session
 * - UserPromptMessage: Follow-up messages in an existing thread session
 */
export class LarkMessageTranslator
	implements IMessageTranslator<LarkWebhookEvent>
{
	/**
	 * Check if this translator can handle the given event.
	 */
	canTranslate(event: unknown): event is LarkWebhookEvent {
		if (!event || typeof event !== "object") {
			return false;
		}

		const e = event as Record<string, unknown>;

		return (
			typeof e.eventType === "string" &&
			e.eventType === "im.message.receive_v1" &&
			typeof e.eventId === "string" &&
			e.payload !== null &&
			typeof e.payload === "object"
		);
	}

	/**
	 * Translate a Lark webhook event into an internal message.
	 *
	 * By default, creates a SessionStartMessage. The EdgeWorker will
	 * determine if this should actually be a UserPromptMessage based
	 * on whether an active session exists.
	 */
	translate(
		event: LarkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		// Determine if this is a session start or user prompt
		// A message that mentions the bot starts a new session
		// A reply in an existing thread is a user prompt
		const isSessionStart =
			payload.mentionedBot || (!payload.rootId && !payload.replyToMessageId);

		if (isSessionStart) {
			return this.translateAsSessionStart(event, context);
		} else {
			return this.translateAsUserPrompt(event, context);
		}
	}

	/**
	 * Translate as session start message.
	 */
	translateAsSessionStart(
		event: LarkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderId || event.tenantKey;

		// Session key: chatId:threadId (or chatId:messageId if not in a thread)
		const threadId = payload.threadId || payload.messageId;
		const sessionKey = `${payload.chatId}:${threadId}`;

		// Work item identifier uses lark:chatId:messageId format
		const workItemIdentifier = `lark:${payload.chatId}:${payload.messageId}`;

		// Strip the @mention and build prompt text
		const promptText = stripMention(payload.content);

		const platformData: LarkSessionStartPlatformData = {
			channel: buildChannelRef(payload.chatId, payload.chatType),
			thread: buildThreadRef(
				payload.messageId,
				payload.rootId,
				payload.replyToMessageId,
			),
			message: buildMessageRef(payload),
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "lark",
			action: "session_start",
			receivedAt: new Date(payload.createTime).toISOString(),
			organizationId,
			sessionKey,
			workItemId: `${payload.chatId}:${threadId}`,
			workItemIdentifier,
			author: {
				id: payload.senderId,
				name: payload.senderName || payload.senderId,
			},
			initialPrompt: promptText,
			title: promptText.slice(0, 100) + (promptText.length > 100 ? "..." : ""),
			platformData,
		};

		return { success: true, message };
	}

	/**
	 * Translate as user prompt message.
	 */
	translateAsUserPrompt(
		event: LarkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderId || event.tenantKey;

		const threadId = payload.threadId || payload.messageId;
		const sessionKey = `${payload.chatId}:${threadId}`;

		const promptText = stripMention(payload.content);

		const platformData: LarkUserPromptPlatformData = {
			channel: buildChannelRef(payload.chatId, payload.chatType),
			thread: buildThreadRef(
				payload.messageId,
				payload.rootId,
				payload.replyToMessageId,
			),
			message: buildMessageRef(payload),
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "lark",
			action: "user_prompt",
			receivedAt: new Date(payload.createTime).toISOString(),
			organizationId,
			sessionKey,
			workItemId: `${payload.chatId}:${threadId}`,
			workItemIdentifier: `lark:${payload.chatId}:${threadId}`,
			author: {
				id: payload.senderId,
				name: payload.senderName || payload.senderId,
			},
			content: promptText,
			platformData,
		};

		return { success: true, message };
	}
}
