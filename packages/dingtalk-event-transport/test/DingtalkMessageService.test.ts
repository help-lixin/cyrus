import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DingtalkMessageService } from "../src/DingtalkMessageService.js";

describe("DingtalkMessageService", () => {
	let service: DingtalkMessageService;
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		service = new DingtalkMessageService();
		mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("getAccessToken", () => {
		it("should return the access token on success", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ accessToken: "token_123", expireIn: 7200 }),
			});

			const token = await service.getAccessToken({
				appKey: "key",
				appSecret: "secret",
			});

			expect(token).toBe("token_123");
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.dingtalk.com/v1.0/oauth2/accessToken",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ appKey: "key", appSecret: "secret" }),
				}),
			);
		});

		it("should throw on HTTP error", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: async () => "invalid appKey",
			});

			await expect(
				service.getAccessToken({ appKey: "bad", appSecret: "bad" }),
			).rejects.toThrow("Failed to get access token");
		});

		it("should throw when accessToken is missing from the response", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({}),
			});

			await expect(
				service.getAccessToken({ appKey: "key", appSecret: "secret" }),
			).rejects.toThrow("missing accessToken");
		});
	});

	describe("sendTextBySessionWebhook", () => {
		const sessionWebhook =
			"https://oapi.dingtalk.com/robot/sendBySession?session=abc123";

		it("should post a text message to the session webhook", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ errcode: 0, errmsg: "ok" }),
			});

			await service.sendTextBySessionWebhook({
				sessionWebhook,
				content: "收到，正在处理...",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				sessionWebhook,
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						msgtype: "text",
						text: { content: "收到，正在处理..." },
					}),
				}),
			);
		});

		it("should throw on HTTP error", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: async () => "boom",
			});

			await expect(
				service.sendTextBySessionWebhook({ sessionWebhook, content: "hi" }),
			).rejects.toThrow("Failed to send session webhook message");
		});

		it("should throw on DingTalk API error (errcode != 0)", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ errcode: 310000, errmsg: "session expired" }),
			});

			await expect(
				service.sendTextBySessionWebhook({ sessionWebhook, content: "hi" }),
			).rejects.toThrow("session expired");
		});
	});

	describe("batchSendTextToUsers", () => {
		it("should post to the batch send endpoint with the access token", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({}),
			});

			await service.batchSendTextToUsers({
				accessToken: "token_123",
				robotCode: "robot_1",
				userIds: ["staff_1", "staff_2"],
				content: "hello",
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"x-acs-dingtalk-access-token": "token_123",
					}),
					body: JSON.stringify({
						robotCode: "robot_1",
						userIds: ["staff_1", "staff_2"],
						msgKey: "sampleText",
						msgParam: JSON.stringify({ content: "hello" }),
					}),
				}),
			);
		});

		it("should throw on HTTP error", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => "invalid token",
			});

			await expect(
				service.batchSendTextToUsers({
					accessToken: "bad",
					robotCode: "robot_1",
					userIds: ["staff_1"],
					content: "hello",
				}),
			).rejects.toThrow("Failed to batch send message");
		});
	});
});
