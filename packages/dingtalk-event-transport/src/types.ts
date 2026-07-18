/**
 * Types for DingTalk event transport
 */

import type { InternalMessage } from "cyrus-core";
import type { RobotTextMessage } from "dingtalk-stream-sdk-nodejs";

/**
 * Configuration for DingtalkEventTransport
 *
 * DingTalk Stream mode uses a WebSocket long connection (DWClient), so no
 * public callback URL or signature verification is required — credentials
 * (appKey/appSecret) authenticate the outbound connection itself.
 */
export interface DingtalkEventTransportConfig {
	/** DingTalk app key (clientId of the internal enterprise app) */
	appKey: string;
	/** DingTalk app secret (clientSecret of the internal enterprise app) */
	appSecret: string;
	/** Whether to enable auto-reconnect for the WebSocket connection */
	autoReconnect?: boolean;
	/**
	 * Live predicate for whether Cyrus should follow plain (non-@mention)
	 * messages in a thread. When it returns false, group messages that do not
	 * @mention the bot are ignored entirely. Omitted ⇒ always enabled.
	 */
	isThreadFollowingEnabled?: () => boolean;
}

/**
 * Events emitted by DingtalkEventTransport
 */
export interface DingtalkEventTransportEvents {
	/** Emitted when a DingTalk robot message is received */
	event: (event: DingtalkWebhookEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
	/** Emitted when the WebSocket connection is established */
	connected: () => void;
	/** Emitted when the WebSocket connection is closed */
	disconnected: () => void;
}

/**
 * Processed DingTalk webhook event that is emitted to listeners
 */
export interface DingtalkWebhookEvent {
	/** The DingTalk event type (always 'robot.message.receive') */
	eventType: DingtalkEventType;
	/** Unique event ID (the message ID) */
	eventId: string;
	/** The full DingTalk robot message payload */
	payload: DingtalkRobotMessage;
	/** Workspace/tenant key (corp ID the bot belongs to) */
	tenantKey: string;
	/** Raw downstream frame from the DingTalk stream SDK */
	rawEvent?: unknown;
}

/**
 * Supported DingTalk event types.
 *
 * - `robot.message.receive`: A message delivered to the robot via the Stream
 *   mode topic `/v1.0/im/bot/messages/get`. In group chats DingTalk only
 *   delivers messages that @mention the bot; in 1:1 (single) chats every
 *   message is delivered.
 */
export type DingtalkEventType = "robot.message.receive";

/**
 * DingTalk robot message payload.
 *
 * Extends the SDK's RobotTextMessage with fields the SDK does not model but
 * that are present on the wire (see DingTalk robot message callback docs).
 */
export interface DingtalkRobotMessage extends RobotTextMessage {
	/** Whether the bot was @mentioned (group chats) */
	isInAtList?: boolean;
	/** Title of the conversation (group chats) */
	conversationTitle?: string;
	/** Users @mentioned in the message */
	atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
}

/**
 * DingTalk conversation type values carried in `conversationType`.
 * - "1": 1:1 (single) chat with the robot
 * - "2": group chat
 */
export type DingtalkConversationType = "1" | "2";
