import { describe, expect, it } from "vitest";
import {
	buildPromptText,
	DingtalkMessageTranslator,
	getSessionKey,
	stripMention,
} from "../src/DingtalkMessageTranslator.js";
import {
	testGroupNoMentionWebhookEvent,
	testSingleWebhookEvent,
	testWebhookEvent,
} from "./fixtures.js";

describe("DingtalkMessageTranslator", () => {
	describe("stripMention", () => {
		it("should strip @mention from text", () => {
			const text = "@Cyrus 请帮我处理这个问题";
			const result = stripMention(text);
			expect(result).toBe("请帮我处理这个问题");
		});

		it("should handle text without mention", () => {
			const text = "Just a regular message";
			const result = stripMention(text);
			expect(result).toBe("Just a regular message");
		});

		it("should handle empty text", () => {
			const text = "";
			const result = stripMention(text);
			expect(result).toBe("");
		});

		it("should handle mention at the end", () => {
			// Note: Current implementation only handles mention at the start
			// This test documents the current behavior
			const text = "请帮我 @Cyrus";
			const result = stripMention(text);
			// Currently returns the full text since mention is not at start
			expect(result).toBe(text);
		});

		it("should trim whitespace", () => {
			const text = "  @Cyrus   消息内容  ";
			const result = stripMention(text);
			expect(result).toBe("消息内容");
		});
	});

	describe("buildPromptText", () => {
		it("should strip mention from message content", () => {
			const result = buildPromptText(testWebhookEvent.payload);
			expect(result).toBe("请帮我处理这个问题");
		});
	});

	describe("getSessionKey", () => {
		it("should use conversationId alone for 1:1 chats", () => {
			const result = getSessionKey(testSingleWebhookEvent.payload);
			expect(result).toBe(testSingleWebhookEvent.payload.conversationId);
		});

		it("should use conversationId:msgId for group chats", () => {
			const result = getSessionKey(testWebhookEvent.payload);
			expect(result).toBe(
				`${testWebhookEvent.payload.conversationId}:${testWebhookEvent.payload.msgId}`,
			);
		});
	});

	describe("canTranslate", () => {
		const translator = new DingtalkMessageTranslator();

		it("should return true for valid DingtalkWebhookEvent", () => {
			expect(translator.canTranslate(testWebhookEvent)).toBe(true);
		});

		it("should return false for null", () => {
			expect(translator.canTranslate(null)).toBe(false);
		});

		it("should return false for undefined", () => {
			expect(translator.canTranslate(undefined)).toBe(false);
		});

		it("should return false for non-object", () => {
			expect(translator.canTranslate("string")).toBe(false);
			expect(translator.canTranslate(123)).toBe(false);
		});

		it("should return false for object without eventType", () => {
			expect(
				translator.canTranslate({
					eventId: "123",
					payload: {},
				}),
			).toBe(false);
		});

		it("should return false for non-message event type", () => {
			expect(
				translator.canTranslate({
					eventType: "other.event",
					eventId: "123",
					payload: {},
				}),
			).toBe(false);
		});
	});

	describe("translate", () => {
		const translator = new DingtalkMessageTranslator();

		describe("session start translation", () => {
			it("should translate group @mention message as session start", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("session_start");
					expect(result.message.source).toBe("dingtalk");
					expect(result.message.author?.id).toBe(
						testWebhookEvent.payload.senderStaffId,
					);
				}
			});

			it("should translate 1:1 (single) message as session start", () => {
				const result = translator.translate(testSingleWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("session_start");
					expect(result.message.platformData).toMatchObject({
						channel: {
							id: testSingleWebhookEvent.payload.conversationId,
							type: "single",
						},
					});
				}
			});

			it("should include initial prompt in session start", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success && result.message.action === "session_start") {
					expect(result.message.initialPrompt).toBe("请帮我处理这个问题");
				}
			});

			it("should use conversationId:msgId as session key for group chats", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.sessionKey).toBe(
						`${testWebhookEvent.payload.conversationId}:${testWebhookEvent.payload.msgId}`,
					);
					expect(result.message.workItemIdentifier).toBe(
						`dingtalk:${testWebhookEvent.payload.conversationId}:${testWebhookEvent.payload.msgId}`,
					);
				}
			});

			it("should include sessionWebhook in platform data", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.platformData).toMatchObject({
						message: {
							sessionWebhook: testWebhookEvent.payload.sessionWebhook,
						},
					});
				}
			});

			it("should use organizationId from context when provided", () => {
				const result = translator.translate(testWebhookEvent, {
					organizationId: "org_from_context",
				});

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.organizationId).toBe("org_from_context");
				}
			});

			it("should fall back to senderCorpId for organizationId", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.organizationId).toBe(
						testWebhookEvent.payload.senderCorpId,
					);
				}
			});
		});

		describe("user prompt translation", () => {
			it("should translate group message without @mention as user prompt", () => {
				const result = translator.translate(testGroupNoMentionWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("user_prompt");
					expect(result.message.source).toBe("dingtalk");
				}
			});

			it("should include content in user prompt", () => {
				const result = translator.translate(testGroupNoMentionWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success && result.message.action === "user_prompt") {
					expect(result.message.content).toBe("顺便修一下认证流程的边界情况");
				}
			});
		});
	});
});
