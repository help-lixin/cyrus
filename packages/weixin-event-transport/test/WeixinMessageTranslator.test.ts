import { describe, expect, it } from "vitest";
import { WeixinMessageTranslator } from "../src/WeixinMessageTranslator.js";
import {
	createGroupMessage,
	createMediaMessage,
	createQuotedMessage,
	createTestMessage,
} from "./fixtures.js";

describe("WeixinMessageTranslator", () => {
	const translator = new WeixinMessageTranslator();

	describe("canTranslate", () => {
		it("returns true for valid Weixin message", () => {
			const msg = createTestMessage();
			expect(translator.canTranslate(msg)).toBe(true);
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

		it("returns false for missing from field", () => {
			const { from: _, ...rest } = createTestMessage();
			expect(translator.canTranslate(rest)).toBe(false);
		});

		it("returns false for missing to field", () => {
			const { to: _, ...rest } = createTestMessage();
			expect(translator.canTranslate(rest)).toBe(false);
		});

		it("returns false for missing text field", () => {
			const { text: _, ...rest } = createTestMessage();
			expect(translator.canTranslate(rest)).toBe(false);
		});
	});

	describe("translate - Session Start", () => {
		it("translates first message from user to SessionStartMessage", () => {
			const msg = createTestMessage({ from: "new_user" });
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("session_start");
			expect(result.message.source).toBe("weixin");
			expect(result.message.sessionKey).toBe("weixin:new_user");
			expect(result.message.workItemId).toBe("weixin:new_user");
			expect(result.message.workItemIdentifier).toBe("weixin:new_user");
			expect(result.message.author?.id).toBe("new_user");
			expect(result.message.initialPrompt).toBe("Hello, bot!");
		});

		it("uses textWithQuote if available", () => {
			const msg = createQuotedMessage({ from: "another_user" });
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("session_start");
			expect(
				(result.message as { initialPrompt: string }).initialPrompt,
			).toContain("[引用:");
		});

		it("marks session as known after first translate", () => {
			const msg = createTestMessage({ from: "brand_new_user" });
			expect(translator.isSessionKnown("brand_new_user")).toBe(false);

			translator.translate(msg);

			expect(translator.isSessionKnown("brand_new_user")).toBe(true);
		});
	});

	describe("translate - User Prompt (subsequent messages)", () => {
		it("translates subsequent message to UserPromptMessage", () => {
			// First, create a session
			const firstMsg = createTestMessage({ from: "existing_user" });
			translator.translate(firstMsg);

			// Now send a follow-up
			const secondMsg = createTestMessage({
				from: "existing_user",
				text: "Follow up message",
			});
			const result = translator.translate(secondMsg);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("user_prompt");
			expect(result.message.sessionKey).toBe("weixin:existing_user");
		});

		it("preserves same session key for same user", () => {
			const firstMsg = createTestMessage({ from: "same_user" });
			const firstResult = translator.translate(firstMsg);

			const secondMsg = createTestMessage({
				from: "same_user",
				text: "Another",
			});
			const secondResult = translator.translate(secondMsg);

			expect(firstResult.success && secondResult.success).toBe(true);
			if (!firstResult.success || !secondResult.success) return;

			expect(firstResult.message.sessionKey).toBe(
				secondResult.message.sessionKey,
			);
		});
	});

	describe("translate - Group messages (not supported)", () => {
		it("rejects group messages with success: false", () => {
			const groupMsg = createGroupMessage();
			const result = translator.translate(groupMsg);

			expect(result.success).toBe(false);
			expect(result.reason).toBe("Group messages not supported");
		});

		it("accepts messages without group_id", () => {
			const msg = createTestMessage({ from: "regular_user" });
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
		});
	});

	describe("translate - Bot's own messages", () => {
		it("rejects messages where from === to (bot's own)", () => {
			const msg = createTestMessage({ from: "bot_001", to: "bot_001" });
			const result = translator.translate(msg);

			expect(result.success).toBe(false);
			expect(result.reason).toBe("Ignoring bot's own message");
		});
	});

	describe("translate - Media messages", () => {
		it("handles image messages", () => {
			const msg = createMediaMessage("image", { from: "media_user" });
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.message.action).toBe("session_start");
		});

		it("handles voice messages with text fallback", () => {
			const msg = createMediaMessage("voice", {
				from: "voice_user",
				text: "Voice message text",
			});
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
		});
	});

	describe("markSessionKnown", () => {
		it("marks a user session as known", () => {
			expect(translator.isSessionKnown("any_user")).toBe(false);
			translator.markSessionKnown("any_user");
			expect(translator.isSessionKnown("any_user")).toBe(true);
		});
	});

	describe("platform data", () => {
		it("includes correct platform data in session start", () => {
			const msg = createTestMessage({
				from: "platform_user",
				messageId: 999,
				timestamp: 1700000000000,
			});
			const result = translator.translate(msg);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const platformData = (
				result.message as {
					platformData: { channel: { id: string }; thread: { ts: string } };
				}
			).platformData;

			expect(platformData.channel.id).toBe("platform_user");
			expect(platformData.thread.ts).toBe("1700000000000");
		});

		it("includes correct platform data in user prompt", () => {
			const firstMsg = createTestMessage({ from: "prompt_user" });
			translator.translate(firstMsg);

			const secondMsg = createTestMessage({
				from: "prompt_user",
				text: "Second message",
			});
			const result = translator.translate(secondMsg);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const platformData = (
				result.message as { platformData: { channel: { id: string } } }
			).platformData;

			expect(platformData.channel.id).toBe("prompt_user");
		});
	});
});
