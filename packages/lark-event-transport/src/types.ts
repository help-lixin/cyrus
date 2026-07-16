/**
 * Types for Lark event transport
 */

import type { NormalizedMessage } from "@larksuiteoapi/node-sdk";
import type { InternalMessage } from "cyrus-core";

/**
 * Verification mode for Lark webhooks
 * - 'ws': WebSocket long connection (primary mode for Lark)
 * - 'webhook': HTTP webhook fallback
 */
export type LarkVerificationMode = "ws" | "webhook";

/**
 * Configuration for LarkEventTransport
 */
export interface LarkEventTransportConfig {
	/** Lark app ID */
	appId: string;
	/** Lark app secret */
	appSecret: string;
	/** Verification mode: 'ws' (WebSocket) or 'webhook' (HTTP) */
	verificationMode: LarkVerificationMode;
	/** Whether to enable auto-reconnect for WebSocket */
	autoReconnect?: boolean;
	/**
	 * Live predicate for whether Cyrus should follow plain (non-@mention)
	 * messages in a thread. When it returns false, `message` events are ignored
	 * entirely. Omitted ⇒ always enabled.
	 */
	isThreadFollowingEnabled?: () => boolean;
}

/**
 * Events emitted by LarkEventTransport
 */
export interface LarkEventTransportEvents {
	/** Emitted when a Lark event is received */
	event: (event: LarkWebhookEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
	/** Emitted when WebSocket connects successfully */
	connected: () => void;
	/** Emitted when WebSocket disconnects */
	disconnected: () => void;
	/** Emitted when WebSocket is reconnecting */
	reconnecting: () => void;
	/** Emitted when bot enters a P2P chat */
	botP2PChatEntered: (data: unknown) => void;
	/** Emitted when a P2P chat is created */
	p2pChatCreated: (data: unknown) => void;
}

/**
 * Processed Lark webhook event that is emitted to listeners
 */
export interface LarkWebhookEvent {
	/** The Lark event type (e.g., 'im.message.receive_v1') */
	eventType: LarkEventType;
	/** Unique event ID */
	eventId: string;
	/** The full normalized Lark message */
	payload: NormalizedMessage;
	/** Workspace/tenant key */
	tenantKey: string;
	/** Raw event data from Lark */
	rawEvent?: unknown;
}

/**
 * Supported Lark event types.
 *
 * - `im.message.receive_v1`: When a message is received (including @mention)
 * - `im.chat.access_event.bot_p2p_chat_entered_v1`: When bot enters a P2P chat
 * - `p2p_chat_create`: Legacy P2P chat creation event
 */
export type LarkEventType =
	| "im.message.receive_v1"
	| "im.chat.access_event.bot_p2p_chat_entered_v1"
	| "p2p_chat_create";

/**
 * Lark message event with full context
 */
export interface LarkMessageEvent {
	/** Event type */
	type: LarkEventType;
	/** Sender information */
	sender: {
		sender_id: {
			open_id?: string;
			user_id?: string;
			union_id?: string;
		};
		sender_type?: string;
		tenant_key?: string;
	};
	/** Message content */
	message: {
		message_id: string;
		root_id?: string;
		parent_id?: string;
		create_time?: string;
		update_time?: string;
		chat_id: string;
		thread_id?: string;
		chat_type: "p2p" | "group";
		message_type: string;
		content: string;
		mentions?: LarkMention[];
	};
}

/**
 * Lark mention information
 */
export interface LarkMention {
	key: string;
	id: {
		open_id?: string;
		user_id?: string;
		union_id?: string;
	};
	name?: string;
	tenant_key?: string;
}
