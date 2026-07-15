/**
 * Test fixtures for Weixin event transport.
 */

import type { WeixinParsedMessage } from "../src/types.js";

/**
 * Create a basic text message fixture.
 */
export function createTestMessage(
	overrides: Partial<WeixinParsedMessage> = {},
): WeixinParsedMessage {
	return {
		messageId: 123456,
		from: "user_001",
		to: "bot_001",
		timestamp: Date.now(),
		contextToken: "ctx_token_abc123",
		text: "Hello, bot!",
		type: "text",
		raw: {
			message_id: 123456,
			from_user_id: "user_001",
			to_user_id: "bot_001",
			create_time_ms: Date.now(),
			context_token: "ctx_token_abc123",
		},
		...overrides,
	};
}

/**
 * Create a quoted message fixture.
 */
export function createQuotedMessage(
	overrides: Partial<WeixinParsedMessage> = {},
): WeixinParsedMessage {
	return createTestMessage({
		text: "This is a reply",
		textWithQuote: "[引用: Hello]\nThis is a reply",
		quotedMessage: {
			title: "Hello",
			text: "Hello",
		},
		...overrides,
	});
}

/**
 * Create a group message fixture (for negative testing).
 */
export function createGroupMessage(
	overrides: Partial<WeixinParsedMessage> = {},
): WeixinParsedMessage {
	return createTestMessage({
		from: "user_002",
		to: "group_001",
		raw: {
			...createTestMessage().raw,
			group_id: "group_001",
			to_user_id: "group_001",
		},
		...overrides,
	});
}

/**
 * Create a media message fixture.
 */
export function createMediaMessage(
	mediaType: "image" | "voice" | "file" | "video" = "image",
	overrides: Partial<WeixinParsedMessage> = {},
): WeixinParsedMessage {
	return createTestMessage({
		type: mediaType,
		text: "",
		raw: {
			...createTestMessage().raw,
		},
		...overrides,
	});
}
