import type { ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QQMessageService } from "../src/QQMessageService.js";

// Mock QQBot
const mockSendText = vi.fn();
const mockSendMarkdown = vi.fn();
const mockSendTyping = vi.fn();

vi.mock("@tencent-connect/qqbot-nodejs", () => {
	return {
		QQBot: vi.fn(),
	};
});

describe("QQMessageService", () => {
	let service: QQMessageService;
	let mockBot: {
		sendText: typeof mockSendText;
		sendMarkdown: typeof mockSendMarkdown;
		sendTyping: typeof mockSendTyping;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockBot = {
			sendText: mockSendText,
			sendMarkdown: mockSendMarkdown,
			sendTyping: mockSendTyping,
		};
		service = new QQMessageService(
			mockBot as unknown as Parameters<typeof QQMessageService>[0]["bot"],
		);
	});

	describe("sendText", () => {
		it("sends text message to target", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			const content = "Hello, world!";
			mockSendText.mockResolvedValue({ id: "msg_123" });

			const result = await service.sendText(target, content);

			expect(mockSendText).toHaveBeenCalledWith(target, content);
			expect(result).toEqual({ id: "msg_123" });
		});

		it("sends text to group", async () => {
			const target: ReplyTarget = { scope: "group", targetId: "group_456" };
			const content = "Group message";
			mockSendText.mockResolvedValue({ id: "msg_456" });

			const result = await service.sendText(target, content);

			expect(mockSendText).toHaveBeenCalledWith(target, content);
			expect(result).toEqual({ id: "msg_456" });
		});

		it("propagates errors from sendText", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			const error = new Error("Send failed");
			mockSendText.mockRejectedValue(error);

			await expect(service.sendText(target, "test")).rejects.toThrow(
				"Send failed",
			);
		});
	});

	describe("sendMarkdown", () => {
		it("sends markdown message to target", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			const content = "# Hello\nThis is **markdown**";
			mockSendMarkdown.mockResolvedValue({ id: "msg_789" });

			const result = await service.sendMarkdown(target, content);

			expect(mockSendMarkdown).toHaveBeenCalledWith(target, content);
			expect(result).toEqual({ id: "msg_789" });
		});

		it("propagates errors from sendMarkdown", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			const error = new Error("Markdown send failed");
			mockSendMarkdown.mockRejectedValue(error);

			await expect(service.sendMarkdown(target, "test")).rejects.toThrow(
				"Markdown send failed",
			);
		});
	});

	describe("sendTyping", () => {
		it("sends typing indicator to C2C target", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			mockSendTyping.mockResolvedValue({ refIdx: "ref_123" });

			const result = await service.sendTyping(target);

			expect(mockSendTyping).toHaveBeenCalledWith(target, undefined);
			expect(result).toEqual({ refIdx: "ref_123" });
		});

		it("sends typing indicator with duration", async () => {
			const target: ReplyTarget = { scope: "c2c", targetId: "user_123" };
			mockSendTyping.mockResolvedValue({});

			await service.sendTyping(target, 5);

			expect(mockSendTyping).toHaveBeenCalledWith(target, 5);
		});
	});
});
