/**
 * Shared test fixtures for DingTalk event transport tests
 */
import type {
	DingtalkRobotMessage,
	DingtalkWebhookEvent,
} from "../src/types.js";

export const testGroupMessage: DingtalkRobotMessage = {
	conversationId: "cidGroup123",
	chatbotCorpId: "dingCorp123",
	chatbotUserId: "dingBotUser123",
	msgId: "msg_1234567890",
	senderNick: "Test User",
	isAdmin: false,
	senderStaffId: "staff_123",
	sessionWebhookExpiredTime: 1704114000000,
	createAt: 1704110400000,
	senderCorpId: "corp_123",
	conversationType: "2",
	senderId: "sender_123",
	sessionWebhook:
		"https://oapi.dingtalk.com/robot/sendBySession?session=abc123",
	robotCode: "dingRobotCode123",
	msgtype: "text",
	text: {
		content: "@Cyrus 请帮我处理这个问题",
	},
	isInAtList: true,
	conversationTitle: "Test Group",
	atUsers: [{ dingtalkId: "$:LWCP_v1:$bot123", staffId: "bot_staff_1" }],
};

export const testSingleMessage: DingtalkRobotMessage = {
	conversationId: "cidSingle456",
	chatbotCorpId: "dingCorp123",
	chatbotUserId: "dingBotUser123",
	msgId: "msg_0987654321",
	senderNick: "Test User",
	isAdmin: false,
	senderStaffId: "staff_456",
	sessionWebhookExpiredTime: 1704114100000,
	createAt: 1704110500000,
	senderCorpId: "corp_123",
	conversationType: "1",
	senderId: "sender_456",
	sessionWebhook:
		"https://oapi.dingtalk.com/robot/sendBySession?session=def456",
	robotCode: "dingRobotCode123",
	msgtype: "text",
	text: {
		content: "开始处理 DEF-123",
	},
};

export const testGroupMessageNoMention: DingtalkRobotMessage = {
	...testGroupMessage,
	msgId: "msg_5555555555",
	text: {
		content: "顺便修一下认证流程的边界情况",
	},
	isInAtList: false,
};

export const testWebhookEvent: DingtalkWebhookEvent = {
	eventType: "robot.message.receive",
	eventId: "msg_1234567890",
	payload: testGroupMessage,
	tenantKey: "dingCorp123",
};

export const testSingleWebhookEvent: DingtalkWebhookEvent = {
	eventType: "robot.message.receive",
	eventId: "msg_0987654321",
	payload: testSingleMessage,
	tenantKey: "dingCorp123",
};

export const testGroupNoMentionWebhookEvent: DingtalkWebhookEvent = {
	eventType: "robot.message.receive",
	eventId: "msg_5555555555",
	payload: testGroupMessageNoMention,
	tenantKey: "dingCorp123",
};
