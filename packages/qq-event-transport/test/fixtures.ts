/**
 * Shared test fixtures for QQ event transport tests
 */
import type { QQWebhookEvent } from "../src/types.js";

/**
 * Test C2C message event (private chat)
 */
export const testC2CMessagePayload = {
	messageId: "msg_1234567890",
	content: "Please help me fix the authentication bug",
	senderId: "user_10001",
	senderName: "TestUser",
	kind: "c2c" as const,
	replyTarget: {
		scope: "c2c" as const,
		targetId: "user_10001",
	},
};

/**
 * Test Group message event (group chat)
 */
export const testGroupMessagePayload = {
	messageId: "msg_2345678901",
	content: "@CyrusBot Please review this PR",
	senderId: "user_10002",
	senderName: "GroupMember",
	kind: "group" as const,
	replyTarget: {
		scope: "group" as const,
		targetId: "group_50001",
	},
};

/**
 * Test C2C webhook event
 */
export const testC2CWebhookEvent: QQWebhookEvent = {
	eventId: "msg_1234567890",
	payload: testC2CMessagePayload,
};

/**
 * Test Group webhook event
 */
export const testGroupWebhookEvent: QQWebhookEvent = {
	eventId: "msg_2345678901",
	payload: testGroupMessagePayload,
};

/**
 * Test message with mention (bot was mentioned)
 */
export const testMentionedMessagePayload = {
	messageId: "msg_3456789012",
	content: "Hey @Cyrus, can you help with the API integration?",
	senderId: "user_10003",
	senderName: "Developer",
	kind: "group" as const,
	replyTarget: {
		scope: "group" as const,
		targetId: "group_50002",
	},
};

/**
 * Test message with parent (reply to a message)
 */
export const testReplyMessagePayload = {
	messageId: "msg_4567890123",
	content: "Good point, let me check that",
	senderId: "user_10004",
	senderName: "Reviewer",
	kind: "c2c" as const,
	replyTarget: {
		scope: "c2c" as const,
		targetId: "user_10005",
		msgId: "msg_1234567890",
	},
};
