/**
 * QQ Message Translator
 *
 * Translates QQ message events into unified internal messages for the
 * internal message bus.
 *
 * @module qq-event-transport/QQMessageTranslator
 */

import { randomUUID } from "node:crypto";
import type {
	IMessageTranslator,
	QQPlatformRef,
	QQSessionStartPlatformData,
	QQUserPromptPlatformData,
	SessionStartMessage,
	TranslationContext,
	TranslationResult,
	UserPromptMessage,
} from "cyrus-core";
import type { QQWebhookEvent } from "./types.js";

/**
 * Translates QQ webhook events into internal messages.
 *
 * QQ messages can result in either:
 * - SessionStartMessage: First mention that starts a session
 * - UserPromptMessage: Follow-up messages in an existing session
 */
export class QQMessageTranslator implements IMessageTranslator<QQWebhookEvent> {
	/**
	 * Check if this translator can handle the given event.
	 */
	canTranslate(event: unknown): event is QQWebhookEvent {
		if (!event || typeof event !== "object") {
			return false;
		}

		const e = event as Record<string, unknown>;

		return (
			e.payload !== null &&
			typeof e.payload === "object" &&
			typeof e.eventId === "string"
		);
	}

	/**
	 * Translate a QQ webhook event into an internal message.
	 *
	 * By default, creates a SessionStartMessage. The EdgeWorker will
	 * determine if this should actually be a UserPromptMessage based
	 * on whether an active session exists.
	 */
	translate(
		event: QQWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderId || "unknown";

		// Session key: scope:targetId:msgId
		const sessionKey = `${payload.replyTarget.scope}:${payload.replyTarget.targetId}:${payload.replyTarget.msgId || payload.messageId}`;

		// Work item identifier
		const workItemIdentifier = `qq:${payload.replyTarget.scope}:${payload.replyTarget.targetId}:${payload.messageId}`;

		const platformData: QQSessionStartPlatformData = {
			channel: this.buildChannelRef(payload.replyTarget),
			thread: this.buildThreadRef(payload),
			message: this.buildMessageRef(payload),
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "qq",
			action: "session_start",
			receivedAt: new Date().toISOString(),
			organizationId,
			sessionKey,
			workItemId: payload.messageId,
			workItemIdentifier,
			author: {
				id: payload.senderId || "unknown",
				name: payload.senderName || payload.senderId || "unknown",
			},
			initialPrompt: payload.content || "",
			title:
				(payload.content || "").slice(0, 100) +
				((payload.content?.length || 0) > 100 ? "..." : ""),
			platformData,
		};

		return { success: true, message };
	}

	/**
	 * Create a UserPromptMessage from a QQ event.
	 * This is called by EdgeWorker when it determines the message
	 * is a follow-up to an existing session.
	 */
	translateAsUserPrompt(
		event: QQWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId =
			context?.organizationId || payload.senderId || "unknown";

		const sessionKey = `${payload.replyTarget.scope}:${payload.replyTarget.targetId}:${payload.replyTarget.msgId || payload.messageId}`;

		const workItemIdentifier = `qq:${payload.replyTarget.scope}:${payload.replyTarget.targetId}:${payload.messageId}`;

		const platformData: QQUserPromptPlatformData = {
			channel: this.buildChannelRef(payload.replyTarget),
			thread: this.buildThreadRef(payload),
			message: this.buildMessageRef(payload),
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "qq",
			action: "user_prompt",
			receivedAt: new Date().toISOString(),
			organizationId,
			sessionKey,
			workItemId: payload.messageId,
			workItemIdentifier,
			author: {
				id: payload.senderId || "unknown",
				name: payload.senderName || payload.senderId || "unknown",
			},
			content: payload.content || "",
			platformData,
		};

		return { success: true, message };
	}

	// ============================================================================
	// HELPER METHODS
	// ============================================================================

	/**
	 * Build channel reference from reply target.
	 */
	private buildChannelRef(
		replyTarget: QQWebhookEvent["payload"]["replyTarget"],
	): QQPlatformRef["channel"] {
		return {
			id: replyTarget.targetId,
			type: replyTarget.scope as "c2c" | "group",
		};
	}

	/**
	 * Build thread reference from QQ message.
	 */
	private buildThreadRef(
		payload: QQWebhookEvent["payload"],
	): QQPlatformRef["thread"] {
		return {
			messageId: payload.messageId,
			parentId: payload.replyTarget.msgId,
		};
	}

	/**
	 * Build message reference from QQ message.
	 */
	private buildMessageRef(
		payload: QQWebhookEvent["payload"],
	): QQPlatformRef["message"] {
		return {
			messageId: payload.messageId,
			text: payload.content || "",
			user: {
				id: payload.senderId || "unknown",
				name: payload.senderName,
			},
		};
	}
}
