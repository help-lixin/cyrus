/**
 * Shared test fixtures for Lark event transport tests
 */
import type { NormalizedMessage } from "@larksuiteoapi/node-sdk";
import type { LarkWebhookEvent } from "../src/types.js";

export const testNormalizedMessage: NormalizedMessage = {
	messageId: "msg_1234567890",
	chatId: "oc_1234567890",
	chatType: "group",
	senderId: "ou_1234567890",
	senderName: "Test User",
	content:
		'<at user_id="ou_bot123">@Cyrus Bot</at> Please help me with this issue',
	rawContentType: "text",
	resources: [],
	mentions: [
		{
			key: '<at user_id="ou_bot123">@Cyrus Bot</at>',
			openId: "ou_bot123",
			userId: "user_bot123",
			name: "Cyrus Bot",
			isBot: true,
		},
	],
	mentionAll: false,
	mentionedBot: true,
	createTime: 1704110400000,
};

export const testP2PMessage: NormalizedMessage = {
	messageId: "msg_0987654321",
	chatId: "oc_0987654321",
	chatType: "p2p",
	senderId: "ou_0987654321",
	senderName: "Test User",
	content: '<at user_id="ou_bot123">@Cyrus Bot</at> Start working on DEF-123',
	rawContentType: "text",
	resources: [],
	mentions: [
		{
			key: '<at user_id="ou_bot123">@Cyrus Bot</at>',
			openId: "ou_bot123",
			userId: "user_bot123",
			name: "Cyrus Bot",
			isBot: true,
		},
	],
	mentionAll: false,
	mentionedBot: true,
	createTime: 1704110500000,
};

export const testThreadedMessage: NormalizedMessage = {
	messageId: "msg_5555555555",
	chatId: "oc_1234567890",
	chatType: "group",
	senderId: "ou_1234567890",
	senderName: "Test User",
	content: "Also fix the edge case in the authentication flow",
	rawContentType: "text",
	resources: [],
	mentions: [],
	mentionAll: false,
	mentionedBot: false,
	rootId: "msg_1234567890",
	threadId: "msg_1234567890",
	replyToMessageId: "msg_1234567890",
	createTime: 1704110600000,
};

export const testWebhookEvent: LarkWebhookEvent = {
	eventType: "im.message.receive_v1",
	eventId: "evt_1234567890",
	payload: testNormalizedMessage,
	tenantKey: "tenant_key_123",
};

export const testP2PWebhookEvent: LarkWebhookEvent = {
	eventType: "im.message.receive_v1",
	eventId: "evt_0987654321",
	payload: testP2PMessage,
	tenantKey: "tenant_key_123",
};

export const testThreadedWebhookEvent: LarkWebhookEvent = {
	eventType: "im.message.receive_v1",
	eventId: "evt_5555555555",
	payload: testThreadedMessage,
	tenantKey: "tenant_key_123",
};
