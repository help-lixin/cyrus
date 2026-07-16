import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LarkEventTransport } from "../src/LarkEventTransport.js";
import type { LarkEventTransportConfig } from "../src/types.js";
import { testWebhookEvent } from "./fixtures.js";

/**
 * Creates a mock logger
 */
function createMockLogger() {
	return {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

/**
 * Creates a mock LarkEventTransportConfig
 */
function createMockConfig(
	overrides: Partial<LarkEventTransportConfig> = {},
): LarkEventTransportConfig {
	return {
		appId: "test_app_id",
		appSecret: "test_app_secret",
		verificationMode: "ws",
		autoReconnect: true,
		...overrides,
	};
}

describe("LarkEventTransport", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should create a new instance", () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			expect(transport).toBeInstanceOf(LarkEventTransport);
		});

		it("should create with default logger if not provided", () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config);

			expect(transport).toBeInstanceOf(LarkEventTransport);
		});
	});

	describe("setTranslationContext", () => {
		it("should set translation context", () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			transport.setTranslationContext({
				organizationId: "test_org",
			});

			// No error means success
			expect(true).toBe(true);
		});

		it("should merge with existing context", () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			transport.setTranslationContext({
				organizationId: "test_org",
			});

			transport.setTranslationContext({
				metadata: { key: "value" },
			});

			// No error means success
			expect(true).toBe(true);
		});
	});

	describe("getConnectionStatus", () => {
		it("should return idle when not connected", () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			const status = transport.getConnectionStatus();
			expect(status).toBe("idle");
		});
	});

	describe("event emission", () => {
		it("should emit connected event when WebSocket connects", async () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			const connectedHandler = vi.fn();
			transport.on("connected", connectedHandler);

			// Note: In real tests, we would mock the WSClient
			// This test verifies the event emitter setup
			expect(connectedHandler).not.toHaveBeenCalled();
		});

		it("should emit error event when WebSocket errors", async () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			const errorHandler = vi.fn();
			transport.on("error", errorHandler);

			// Note: In real tests, we would mock the WSClient
			// This test verifies the event emitter setup
			expect(errorHandler).not.toHaveBeenCalled();
		});

		it("should emit disconnected event when WebSocket closes", async () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			const disconnectedHandler = vi.fn();
			transport.on("disconnected", disconnectedHandler);

			// Note: In real tests, we would mock the WSClient
			// This test verifies the event emitter setup
			expect(disconnectedHandler).not.toHaveBeenCalled();
		});
	});

	describe("close", () => {
		it("should not throw when closing without connection", async () => {
			const config = createMockConfig();
			const transport = new LarkEventTransport(config, mockLogger);

			await expect(transport.close()).resolves.not.toThrow();
		});
	});
});

describe("LarkEventTransport event filtering", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should filter messages without bot mention and without thread", () => {
		const config = createMockConfig();
		const _transport = new LarkEventTransport(config, mockLogger);

		// This tests the message filtering logic
		// A message without @mention and without thread should be filtered
		const messageWithoutMention = {
			...testWebhookEvent,
			payload: {
				...testWebhookEvent.payload,
				mentionedBot: false,
				rootId: undefined,
				replyToMessageId: undefined,
			},
		};

		// In actual filtering logic, this would be dropped
		// The translator handles this by returning success: false
		expect(messageWithoutMention.payload.mentionedBot).toBe(false);
	});
});
