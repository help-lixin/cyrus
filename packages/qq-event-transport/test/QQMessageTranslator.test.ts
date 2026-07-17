import { describe, expect, it } from "vitest";
import { QQMessageTranslator } from "../src/QQMessageTranslator.js";
import {
	testC2CWebhookEvent,
	testGroupWebhookEvent,
	testReplyMessagePayload,
} from "./fixtures.js";

describe("QQMessageTranslator", () => {
	const translator = new QQMessageTranslator();

	describe("canTranslate", () => {
		it("returns true for valid C2C webhook events", () => {
			expect(translator.canTranslate(testC2CWebhookEvent)).toBe(true);
		});

		it("returns true for valid Group webhook events", () => {
			expect(translator.canTranslate(testGroupWebhookEvent)).toBe(true);
		});

		it("returns false for null", () => {
			expect(translator.canTranslate(null)).toBe(false);
		});

		it("returns false for undefined", () => {
			expect(translator.canTranslate(undefined)).toBe(false);
		});

		it("returns false for non-object", () => {
			expect(translator.canTranslate("string")).toBe(false);
		});

		it("returns false for missing eventId", () => {
			const { eventId: _, ...rest } = testC2CWebhookEvent;
			expect(translator.canTranslate(rest)).toBe(false);
		});

		it("returns false for null payload", () => {
			expect(
				translator.canTranslate({
					...testC2CWebhookEvent,
					payload: null,
				}),
			).toBe(false);
		});

		it("returns false for missing payload", () => {
			const { payload: _, ...rest } = testC2CWebhookEvent;
			expect(translator.canTranslate(rest)).toBe(false);
		});
	});

	describe("translate (SessionStartMessage)", () => {
		it("translates C2C message to SessionStartMessage", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.source).toBe("qq");
			expect(result.message.action).toBe("session_start");
		});

		it("translates Group message to SessionStartMessage", () => {
			const result = translator.translate(testGroupWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.source).toBe("qq");
			expect(result.message.action).toBe("session_start");
		});

		it("sets correct session key for C2C messages", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			// C2C: sessionKey = c2c:userId:msgId
			expect(result.message.sessionKey).toBe(
				`c2c:${testC2CWebhookEvent.payload.replyTarget.targetId}:${testC2CWebhookEvent.payload.messageId}`,
			);
		});

		it("sets correct session key for Group messages", () => {
			const result = translator.translate(testGroupWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			// Group: sessionKey = group:groupId:msgId
			expect(result.message.sessionKey).toBe(
				`group:${testGroupWebhookEvent.payload.replyTarget.targetId}:${testGroupWebhookEvent.payload.messageId}`,
			);
		});

		it("sets correct work item identifier", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.workItemIdentifier).toBe(
				`qq:c2c:${testC2CWebhookEvent.payload.replyTarget.targetId}:${testC2CWebhookEvent.payload.messageId}`,
			);
		});

		it("extracts correct author information", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.author?.id).toBe(
				testC2CWebhookEvent.payload.senderId,
			);
			expect(result.message.author?.name).toBe(
				testC2CWebhookEvent.payload.senderName,
			);
		});

		it("extracts message content as initial prompt", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.initialPrompt).toBe(
				testC2CWebhookEvent.payload.content,
			);
		});

		it("sets platform data with correct channel type", () => {
			const result = translator.translate(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const platformData = result.message.platformData as {
				channel: { type: string };
			};
			expect(platformData.channel.type).toBe("c2c");
		});

		it("sets platform data with correct group channel type", () => {
			const result = translator.translate(testGroupWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const platformData = result.message.platformData as {
				channel: { type: string };
			};
			expect(platformData.channel.type).toBe("group");
		});
	});

	describe("translateAsUserPrompt", () => {
		it("translates C2C message to UserPromptMessage", () => {
			const result = translator.translateAsUserPrompt(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.source).toBe("qq");
			expect(result.message.action).toBe("user_prompt");
		});

		it("translates Group message to UserPromptMessage", () => {
			const result = translator.translateAsUserPrompt(testGroupWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.source).toBe("qq");
			expect(result.message.action).toBe("user_prompt");
		});

		it("sets correct content in UserPromptMessage", () => {
			const result = translator.translateAsUserPrompt(testC2CWebhookEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect((result.message as { content: string }).content).toBe(
				testC2CWebhookEvent.payload.content,
			);
		});
	});

	describe("with reply context", () => {
		it("handles messages with parent msgId", () => {
			const replyEvent = {
				eventId: testReplyMessagePayload.messageId,
				payload: testReplyMessagePayload,
			};
			const result = translator.translate(replyEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			// Should include parent msgId in session key
			expect(result.message.sessionKey).toContain(
				testReplyMessagePayload.replyTarget.msgId!,
			);
		});
	});
});
