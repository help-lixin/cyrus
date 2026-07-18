/**
 * DingTalk Message Translator
 *
 * Translates DingTalk robot message events into unified internal messages for
 * the internal message bus.
 */

import { randomUUID } from "node:crypto";
import type {
	DingtalkPlatformRef,
	DingtalkSessionStartPlatformData,
	DingtalkUserPromptPlatformData,
	IMessageTranslator,
	SessionStartMessage,
	TranslationContext,
	TranslationResult,
	UserPromptMessage,
} from "cyrus-core";
import type { DingtalkRobotMessage, DingtalkWebhookEvent } from "./types.js";

/**
 * Build channel reference from conversation data.
 */
function buildChannelRef(
	conversationId: string,
	conversationType: string,
	conversationTitle?: string,
): DingtalkPlatformRef["channel"] {
	return {
		id: conversationId,
		name: conversationTitle,
		type: conversationType === "1" ? "single" : "group",
	};
}

/**
 * Build thread reference from message data.
 * DingTalk robot messages carry no thread/root IDs, so the message itself is
 * the thread anchor.
 */
function buildThreadRef(messageId: string): DingtalkPlatformRef["thread"] {
	return {
		messageId,
	};
}

/**
 * Build message reference from a DingTalk robot message.
 */
function buildMessageRef(
	message: DingtalkRobotMessage,
): DingtalkPlatformRef["message"] {
	return {
		messageId: message.msgId,
		text: message.text?.content ?? "",
		sessionWebhook: message.sessionWebhook,
		user: {
			id: message.senderStaffId || message.senderId,
			name: message.senderNick,
		},
	};
}

/**
 * Strips a leading "@nickname" mention from DingTalk message text.
 * In group chats the message text may start with the bot's @mention.
 */
export function stripMention(text: string): string {
	return text.replace(/^\s*@[^\s@]+\s+/, "").trim();
}

/**
 * Extract the prompt text from a DingTalk robot message.
 */
export function buildPromptText(message: DingtalkRobotMessage): string {
	return stripMention(message.text?.content ?? "");
}

/**
 * Derive the session key for a DingTalk robot message.
 *
 * - 1:1 (single) chats: all messages belong to the same session, keyed by the
 *   conversation ID.
 * - Group chats: DingTalk has no thread concept for robots, so each @mention
 *   starts its own session, keyed by conversation ID + message ID.
 */
export function getSessionKey(message: DingtalkRobotMessage): string {
	if (message.conversationType === "1") {
		return message.conversationId;
	}
	return `${message.conversationId}:${message.msgId}`;
}

/**
 * Translates DingTalk robot message events into internal messages.
 *
 * Note: DingTalk events can result in either:
 * - SessionStartMessage: An @mention in a group, or any message in a 1:1 chat
 * - UserPromptMessage: A group message that does not @mention the bot (only
 *   reachable if DingTalk ever delivers non-mention group messages)
 *
 * The distinction between session start vs user prompt is also refined by
 * the EdgeWorker based on whether an active session exists for the thread.
 */
export class DingtalkMessageTranslator
	implements IMessageTranslator<DingtalkWebhookEvent>
{
	/**
	 * Check if this translator can handle the given event.
	 */
	canTranslate(event: unknown): event is DingtalkWebhookEvent {
		if (!event || typeof event !== "object") {
			return false;
		}

		const e = event as Record<string, unknown>;

		return (
			typeof e.eventType === "string" &&
			e.eventType === "robot.message.receive" &&
			typeof e.eventId === "string" &&
			e.payload !== null &&
			typeof e.payload === "object"
		);
	}

	/**
	 * Translate a DingTalk webhook event into an internal message.
	 *
	 * By default, creates a SessionStartMessage for @mentions and 1:1
	 * messages. The EdgeWorker will determine if this should actually be a
	 * UserPromptMessage based on whether an active session exists.
	 */
	translate(
		event: DingtalkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		// 1:1 (single) chat messages and group @mentions start a session;
		// anything else (a group message without an @mention) is treated as a
		// follow-up prompt for an already-bound conversation.
		const isSessionStart =
			payload.conversationType === "1" || payload.isInAtList === true;

		if (isSessionStart) {
			return this.translateAsSessionStart(event, context);
		}
		return this.translateAsUserPrompt(event, context);
	}

	/**
	 * Translate as session start message.
	 */
	translateAsSessionStart(
		event: DingtalkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderCorpId || event.tenantKey;

		const sessionKey = getSessionKey(payload);

		// Work item identifier uses dingtalk:conversationId:msgId format
		const workItemIdentifier = `dingtalk:${payload.conversationId}:${payload.msgId}`;

		const promptText = buildPromptText(payload);

		const platformData: DingtalkSessionStartPlatformData = {
			channel: buildChannelRef(
				payload.conversationId,
				payload.conversationType,
				payload.conversationTitle,
			),
			thread: buildThreadRef(payload.msgId),
			message: buildMessageRef(payload),
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "dingtalk",
			action: "session_start",
			receivedAt: new Date(payload.createAt).toISOString(),
			organizationId,
			sessionKey,
			workItemId: sessionKey,
			workItemIdentifier,
			author: {
				id: payload.senderStaffId || payload.senderId,
				name: payload.senderNick,
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
		event: DingtalkWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderCorpId || event.tenantKey;

		const sessionKey = getSessionKey(payload);

		const promptText = buildPromptText(payload);

		const platformData: DingtalkUserPromptPlatformData = {
			channel: buildChannelRef(
				payload.conversationId,
				payload.conversationType,
				payload.conversationTitle,
			),
			thread: buildThreadRef(payload.msgId),
			message: buildMessageRef(payload),
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "dingtalk",
			action: "user_prompt",
			receivedAt: new Date(payload.createAt).toISOString(),
			organizationId,
			sessionKey,
			workItemId: sessionKey,
			workItemIdentifier: `dingtalk:${payload.conversationId}:${payload.msgId}`,
			author: {
				id: payload.senderStaffId || payload.senderId,
				name: payload.senderNick,
			},
			content: promptText,
			platformData,
		};

		return { success: true, message };
	}
}
