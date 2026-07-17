/**
 * Types for QQ event transport
 */

import type {
	InboundMessage,
	ReplyTarget,
} from "@tencent-connect/qqbot-nodejs";
import type { InternalMessage } from "cyrus-core";

/**
 * Configuration for QQEventTransport
 */
export interface QQEventTransportConfig {
	/** QQ Open Platform App ID */
	appId: string;
	/** QQ Open Platform App Secret */
	appSecret: string;
	/**
	 * Live predicate for whether Cyrus should follow plain (non-@mention)
	 * messages in a thread. When it returns false, messages are ignored
	 * unless they mention the bot. Omitted ⇒ always enabled.
	 */
	isThreadFollowingEnabled?: () => boolean;
	/** Whether the bot supports markdown messages (default: false) */
	markdownSupport?: boolean;
}

/**
 * Events emitted by QQEventTransport
 */
export interface QQEventTransportEvents {
	/** Emitted when a QQ message event is received */
	event: (event: QQWebhookEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
}

/**
 * Processed QQ event that is emitted to listeners
 */
export interface QQWebhookEvent {
	/** The QQ message event (normalized InboundMessage with replyTarget) */
	payload: InboundMessage & { replyTarget: ReplyTarget };
	/** Unique event ID */
	eventId: string;
}
