import { describe, expect, it } from "vitest";
import {
	LarkMessageTranslator,
	stripMention,
} from "../src/LarkMessageTranslator.js";
import {
	testP2PWebhookEvent,
	testThreadedWebhookEvent,
	testWebhookEvent,
} from "./fixtures.js";

describe("LarkMessageTranslator", () => {
	describe("stripMention", () => {
		it("should strip @mention from text", () => {
			const text = '<at user_id="ou_123">@Cyrus Bot</at> Please help me';
			const result = stripMention(text);
			expect(result).toBe("Please help me");
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
			const text = 'Please help me <at user_id="ou_123">@Cyrus Bot</at>';
			const result = stripMention(text);
			// Currently returns the full text since mention is not at start
			expect(result).toBe(text);
		});

		it("should trim whitespace", () => {
			const text = '  <at user_id="ou_123">@Cyrus Bot</at>   Message  ';
			const result = stripMention(text);
			expect(result).toBe("Message");
		});
	});

	describe("canTranslate", () => {
		const translator = new LarkMessageTranslator();

		it("should return true for valid LarkWebhookEvent", () => {
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
		const translator = new LarkMessageTranslator();

		describe("session start translation", () => {
			it("should translate @mention message as session start", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("session_start");
					expect(result.message.source).toBe("lark");
					expect(result.message.author?.id).toBe(
						testWebhookEvent.payload.senderId,
					);
				}
			});

			it("should translate p2p message as session start", () => {
				const result = translator.translate(testP2PWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("session_start");
					expect(result.message.platformData).toMatchObject({
						channel: {
							id: testP2PWebhookEvent.payload.chatId,
							type: "p2p",
						},
					});
				}
			});

			it("should include initial prompt in session start", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.initialPrompt).toBeDefined();
					expect(result.message.initialPrompt.length).toBeGreaterThan(0);
				}
			});

			it("should generate correct session key", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					const expectedKey = `${testWebhookEvent.payload.chatId}:${testWebhookEvent.payload.threadId || testWebhookEvent.payload.messageId}`;
					expect(result.message.sessionKey).toBe(expectedKey);
				}
			});
		});

		describe("user prompt translation", () => {
			it("should translate threaded reply as user prompt", () => {
				const result = translator.translate(testThreadedWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.action).toBe("user_prompt");
					expect(result.message.content).toBeDefined();
				}
			});
		});

		describe("translation context", () => {
			it("should use provided organizationId", () => {
				const context = { organizationId: "custom_org_123" };
				const result = translator.translate(testWebhookEvent, context);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.organizationId).toBe("custom_org_123");
				}
			});

			it("should fall back to senderId when no organizationId provided", () => {
				const result = translator.translate(testWebhookEvent);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.message.organizationId).toBe(
						testWebhookEvent.payload.senderId,
					);
				}
			});
		});
	});

	describe("translateAsSessionStart", () => {
		const translator = new LarkMessageTranslator();

		it("should create session start message with correct structure", () => {
			const result = translator.translateAsSessionStart(testWebhookEvent);

			expect(result.success).toBe(true);
			if (result.success) {
				const message = result.message;
				expect(message.action).toBe("session_start");
				expect(message.source).toBe("lark");
				expect(message.id).toBeDefined();
				expect(message.receivedAt).toBeDefined();
				expect(message.sessionKey).toBeDefined();
				expect(message.workItemId).toBeDefined();
				expect(message.workItemIdentifier).toBeDefined();
				expect(message.author).toBeDefined();
				expect(message.initialPrompt).toBeDefined();
				expect(message.title).toBeDefined();
				expect(message.platformData).toBeDefined();
			}
		});

		it("should include channel info in platform data", () => {
			const result = translator.translateAsSessionStart(testWebhookEvent);

			expect(result.success).toBe(true);
			if (result.success) {
				const platformData = result.message.platformData as {
					channel: { id: string; type: string };
				};
				expect(platformData.channel.id).toBe(testWebhookEvent.payload.chatId);
				expect(platformData.channel.type).toBe(
					testWebhookEvent.payload.chatType,
				);
			}
		});

		it("should include thread info in platform data", () => {
			const result = translator.translateAsSessionStart(testWebhookEvent);

			expect(result.success).toBe(true);
			if (result.success) {
				const platformData = result.message.platformData as {
					thread: { messageId: string; rootId?: string; parentId?: string };
				};
				expect(platformData.thread.messageId).toBe(
					testWebhookEvent.payload.messageId,
				);
			}
		});
	});

	describe("translateAsUserPrompt", () => {
		const translator = new LarkMessageTranslator();

		it("should create user prompt message with correct structure", () => {
			const result = translator.translateAsUserPrompt(testThreadedWebhookEvent);

			expect(result.success).toBe(true);
			if (result.success) {
				const message = result.message;
				expect(message.action).toBe("user_prompt");
				expect(message.source).toBe("lark");
				expect(message.content).toBeDefined();
			}
		});

		it("should include content in user prompt", () => {
			const result = translator.translateAsUserPrompt(testThreadedWebhookEvent);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.message.content).toBe(
					testThreadedWebhookEvent.payload.content,
				);
			}
		});
	});
});
